"""The voice settings (common.whatsapp.voice), who reads them (speech, transcription),
the voice-config Lambda behind the web's "Voz" page and how the agent worker uses voice.
No AWS call.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import base64
import importlib.util
import io
import json
import unittest
from unittest import mock

import test_ws_handler as support
from common.whatsapp import http, speech, transcription, voice

spec = importlib.util.spec_from_file_location(
    "voice_config", support.ROOT / "src" / "lambda" / "whatsapp" / "voice-config" / "index.py"
)
voice_config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice_config)

POLLY_VOICES = [
    {"Id": "Lupe", "Name": "Lupe", "Gender": "Female", "LanguageCode": "es-US", "SupportedEngines": ["standard", "neural", "generative"]},
    {"Id": "Pedro", "Name": "Pedro", "Gender": "Male", "LanguageCode": "es-US", "SupportedEngines": ["neural"]},
    {"Id": "Mia", "Name": "Mia", "Gender": "Female", "LanguageCode": "es-MX", "SupportedEngines": ["neural"]},
    {"Id": "Joanna", "Name": "Joanna", "Gender": "Female", "LanguageCode": "en-US", "SupportedEngines": ["neural"]},
]


def ssm_with(value) -> mock.MagicMock:
    ssm = mock.MagicMock()
    ssm.get_parameter.return_value = {"Parameter": {"Value": json.dumps(value)}}
    return ssm


class VoiceSettingsTest(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(voice, "PARAMETER_NAME", "/p-dev-voice-settings"),
            mock.patch.object(voice, "_cache", None),
        ]
        for patcher in patches:
            patcher.start()
        self.addCleanup(mock.patch.stopall)

    def test_reads_the_parameter_and_caches_it(self):
        ssm = ssm_with({"voiceId": "Pedro", "engine": "neural", "transcribeLanguage": "es-ES"})
        with mock.patch.object(voice, "_ssm", ssm):
            self.assertEqual(voice.read()["voiceId"], "Pedro")
            self.assertEqual(voice.read()["transcribeLanguage"], "es-ES")
            self.assertEqual(ssm.get_parameter.call_count, 1)
            voice.read(fresh=True)
            self.assertEqual(ssm.get_parameter.call_count, 2)

    def test_missing_or_unreadable_values_fall_back_to_the_defaults(self):
        with mock.patch.object(voice, "_ssm", ssm_with({"voiceId": "", "transcribeLanguage": "fr-FR"})):
            settings = voice.read(fresh=True)
        self.assertEqual((settings["voiceId"], settings["engine"], settings["transcribeLanguage"]), ("Lupe", "neural", "es-US"))
        self.assertEqual(settings["replyWithAudio"], "voice_notes")
        broken = mock.MagicMock()
        broken.get_parameter.side_effect = RuntimeError("SSM down")
        with mock.patch.object(voice, "_ssm", broken):
            self.assertEqual(voice.read(fresh=True)["voiceId"], "Lupe")

    def test_a_bad_provider_or_reply_mode_falls_back_to_the_defaults(self):
        stored = {"provider": "nova", "replyWithAudio": "sometimes"}
        with mock.patch.object(voice, "_ssm", ssm_with(stored)):
            settings = voice.read(fresh=True)
        self.assertIn(settings["provider"], voice.PROVIDERS)
        self.assertIn(settings["replyWithAudio"], voice.REPLY_MODES)

    def test_voice_is_on_only_with_the_polly_provider(self):
        for provider, expected in (("polly", True), ("none", False)):
            with mock.patch.object(voice, "_ssm", ssm_with({"provider": provider})):
                voice.read(fresh=True)
                self.assertIs(voice.enabled(), expected)

    def test_write_overwrites_the_parameter(self):
        ssm = mock.MagicMock()
        with mock.patch.object(voice, "_ssm", ssm):
            saved = voice.write({"voiceId": "Mia", "engine": "neural", "transcribeLanguage": "es-US", "updatedBy": "a@b.cl"})
            self.assertEqual(voice.read()["voiceId"], "Mia")
        call = ssm.put_parameter.call_args.kwargs
        self.assertEqual((call["Name"], call["Overwrite"]), ("/p-dev-voice-settings", True))
        self.assertEqual(json.loads(call["Value"])["voiceId"], "Mia")
        self.assertEqual(saved["updatedBy"], "a@b.cl")
        ssm.get_parameter.assert_not_called()

    def test_speech_and_transcription_use_the_configured_settings(self):
        polly = mock.MagicMock()
        polly.synthesize_speech.return_value = {"AudioStream": io.BytesIO(b"MP3")}
        client = mock.MagicMock()
        client.get_transcription_job.return_value = {"TranscriptionJob": {"TranscriptionJobStatus": "FAILED"}}
        settings = {"voiceId": "Pedro", "engine": "generative", "transcribeLanguage": "es-ES"}
        with mock.patch.object(voice, "_ssm", ssm_with(settings)), \
                mock.patch.object(speech, "_polly", return_value=polly), \
                mock.patch.object(transcription, "_client", client), \
                mock.patch.object(transcription.media, "MEDIA_BUCKET_NAME", "bucket"):
            speech.synthesize("Hola.")
            with self.assertRaises(transcription.TranscriptionFailed):
                transcription.transcribe("media/a.ogg")
        call = polly.synthesize_speech.call_args.kwargs
        self.assertEqual((call["VoiceId"], call["Engine"]), ("Pedro", "generative"))
        self.assertEqual(client.start_transcription_job.call_args.kwargs["LanguageCode"], "es-ES")


CHOICE = {"provider": "polly", "replyWithAudio": "always"}


def api_event(method: str, resource: str = "/whatsapp/voice", body: dict | None = None) -> dict:
    return {
        "httpMethod": method,
        "resource": resource,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"username": "u1", "email": "ana@example.com", "groups": "admin"}},
    }


class VoiceConfigLambdaTest(unittest.TestCase):
    def setUp(self):
        self.polly = mock.MagicMock()
        self.polly.describe_voices.return_value = {"Voices": POLLY_VOICES}
        self.written = []
        patches = [
            mock.patch.object(voice_config, "polly", self.polly),
            mock.patch.object(http, "is_allowed", return_value=True),
            mock.patch.object(voice, "read", return_value=dict(voice.DEFAULTS)),
            mock.patch.object(voice, "write", side_effect=lambda s: self.written.append(s) or s),
            mock.patch.object(speech, "synthesize", return_value=b"MP3"),
        ]
        self.mocks = {p.attribute: p.start() for p in patches}
        self.addCleanup(mock.patch.stopall)

    def call(self, event: dict) -> tuple[int, dict]:
        response = voice_config.handler(event, None)
        return response["statusCode"], json.loads(response["body"])

    def test_lists_only_spanish_voices_latin_first_with_their_engines(self):
        status, body = self.call(api_event("GET"))
        self.assertEqual(status, 200)
        data = body["data"]
        self.assertEqual([v["id"] for v in data["voices"]], ["Lupe", "Pedro", "Mia"])
        self.assertEqual(data["voices"][0]["engines"], ["neural", "generative", "standard"])
        self.assertEqual(data["voices"][2]["languageName"], "Español (México)")
        self.assertEqual([l["code"] for l in data["languages"]], ["es-US", "es-ES"])
        self.assertEqual(data["settings"]["voiceId"], "Lupe")
        self.assertEqual(data["providers"], ["none", "polly"])
        self.assertEqual(data["replyModes"], ["off", "voice_notes", "always"])

    def test_saves_a_valid_choice_with_its_author(self):
        status, _ = self.call(api_event("PUT", body={**CHOICE, "voiceId": "Pedro", "engine": "neural", "transcribeLanguage": "es-ES"}))
        self.assertEqual(status, 200)
        self.assertEqual(self.written[0]["voiceId"], "Pedro")
        self.assertEqual(self.written[0]["transcribeLanguage"], "es-ES")
        self.assertEqual((self.written[0]["provider"], self.written[0]["replyWithAudio"]), ("polly", "always"))
        self.assertEqual(self.written[0]["updatedBy"], "ana@example.com")
        self.assertTrue(self.written[0]["updatedAt"])

    def test_refuses_a_voice_engine_or_language_that_does_not_exist(self):
        for body in (
            {**CHOICE, "voiceId": "Joanna", "engine": "neural", "transcribeLanguage": "es-US"},
            {**CHOICE, "voiceId": "Pedro", "engine": "standard", "transcribeLanguage": "es-US"},
            {**CHOICE, "voiceId": "Pedro", "engine": "neural", "transcribeLanguage": "es-CL"},
            {**CHOICE, "provider": "nova", "voiceId": "Pedro", "engine": "neural", "transcribeLanguage": "es-US"},
            {**CHOICE, "replyWithAudio": "sometimes", "voiceId": "Pedro", "engine": "neural", "transcribeLanguage": "es-US"},
        ):
            status, payload = self.call(api_event("PUT", body=body))
            self.assertEqual(status, 422, body)
            self.assertEqual(payload["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(self.written, [])

    def test_preview_returns_the_sample_as_base64_mp3(self):
        status, body = self.call(api_event("POST", "/whatsapp/voice/preview", {"voiceId": "Mia", "engine": "neural"}))
        self.assertEqual(status, 200)
        self.assertEqual(base64.b64decode(body["data"]["audio"]), b"MP3")
        self.assertEqual(body["data"]["mimeType"], "audio/mpeg")
        args = self.mocks["synthesize"].call_args.args
        self.assertEqual((args[0], args[1], args[2]), (voice_config.SAMPLE_TEXT, "Mia", "neural"))
        self.assertEqual(self.written, [])

    def test_preview_refuses_a_text_too_long(self):
        status, _ = self.call(api_event("POST", "/whatsapp/voice/preview", {"voiceId": "Mia", "engine": "neural", "text": "a" * 301}))
        self.assertEqual(status, 422)
        self.mocks["synthesize"].assert_not_called()

    def test_needs_the_voice_permission(self):
        self.mocks["is_allowed"].return_value = False
        status, _ = self.call(api_event("GET"))
        self.assertEqual(status, 403)
        self.assertEqual(self.mocks["is_allowed"].call_args.args[1], "voice")
        self.polly.describe_voices.assert_not_called()


class SpeechTextTest(unittest.TestCase):
    def test_speakable_drops_icons_and_formatting_and_says_dates(self):
        text = speech.speakable("*Hola* \U0001F600 | pedido 12-11-2026 14:30\n---\nGracias")
        self.assertNotIn("*", text)
        self.assertNotIn("|", text)
        self.assertIn("12 de noviembre a las 14:30", text)

    def test_chunks_stay_under_the_limit_and_keep_every_word(self):
        text = ". ".join(f"frase numero {i}" for i in range(400))
        pieces = speech.chunks(text, 200)
        self.assertTrue(all(len(piece) <= 200 for piece in pieces))
        self.assertEqual(" ".join(" ".join(pieces).split()), " ".join(text.split()))

    def test_nothing_to_read_is_an_error(self):
        with self.assertRaises(ValueError):
            speech.synthesize("\U0001F600 ---")


class AgentWorkerVoiceTest(unittest.TestCase):
    """What the worker does with a voice note and with the audio answer."""

    def setUp(self):
        import test_agent as agent_support

        self.support = agent_support
        self.worker = agent_support.agent_worker
        self.saved = []

        def save_message(phone, direction, message_type, text="", **extra):
            item = {"phone": phone, "direction": direction, "type": message_type, "message": text, **extra}
            self.saved.append(item)
            return item

        self.settings = {"provider": "polly", "replyWithAudio": "voice_notes"}
        self.result = {"status": "ok", "response": "Tenemos despacho a todo Chile.", "handoff": False}
        patches = [
            mock.patch.object(self.worker.store, "get_conversation", return_value=agent_support.open_conversation()),
            mock.patch.object(self.worker.store, "save_message", side_effect=save_message),
            mock.patch.object(self.worker.store, "touch_conversation", return_value=agent_support.open_conversation()),
            mock.patch.object(self.worker.store, "mark_message", return_value={"phone": agent_support.PHONE}),
            mock.patch.object(self.worker.realtime, "announce_message"),
            mock.patch.object(self.worker.realtime, "publish"),
            mock.patch.object(self.worker.messaging, "send_text", return_value="wamid.text"),
            mock.patch.object(self.worker.messaging, "send_media", return_value="wamid.audio"),
            mock.patch.object(self.worker, "invoke_agent", side_effect=lambda job: self.result),
            mock.patch.object(self.worker.voice, "read", side_effect=lambda *a, **k: {**voice.DEFAULTS, **self.settings}),
            mock.patch.object(self.worker.transcription, "transcribe", return_value="¿tienen despacho a Punta Arenas?"),
            mock.patch.object(self.worker.speech, "synthesize", return_value=b"MP3"),
            mock.patch.object(self.worker.media, "upload_outbound", return_value="outbound/" + "a" * 36 + ".mp3"),
            mock.patch.object(self.worker.media, "post_to_whatsapp", return_value="media-1"),
            mock.patch.object(self.worker.media, "exposed", side_effect=lambda item: item),
        ]
        self.mocks = {p.attribute: p.start() for p in patches}
        self.addCleanup(mock.patch.stopall)

    def run_job(self, **extra):
        return self.worker.process(self.support.job(**extra))

    def voice_note(self):
        return {"audio": {"key": "media/a.ogg", "mimeType": "audio/ogg", "voice": True}, "text": "[Audio]"}

    def test_a_voice_note_is_transcribed_and_the_agent_reads_the_text(self):
        seen = []
        self.mocks["invoke_agent"].side_effect = lambda job: seen.append(job["text"]) or self.result
        self.assertEqual(self.run_job(**self.voice_note()), "answered")
        self.assertEqual(seen, ["¿tienen despacho a Punta Arenas?"])
        self.assertEqual(self.mocks["mark_message"].call_args.kwargs["transcript"], "¿tienen despacho a Punta Arenas?")

    def test_the_answer_to_a_voice_note_also_goes_as_audio(self):
        self.run_job(**self.voice_note())
        self.mocks["send_text"].assert_called_once()
        self.mocks["send_media"].assert_called_once()
        self.assertEqual(self.mocks["send_media"].call_args.args[1], "audio")
        audio = next(item for item in self.saved if item["type"] == "audio")
        self.assertEqual(audio["sent_by"], "agent")
        self.assertEqual(audio["transcript"], speech.speakable(self.result["response"]))
        self.assertEqual(audio["media"]["mimeType"], "audio/mpeg")

    def test_a_written_message_gets_text_only_in_voice_notes_mode(self):
        self.run_job()
        self.mocks["send_media"].assert_not_called()

    def test_always_mode_answers_everything_with_audio_too(self):
        self.settings["replyWithAudio"] = "always"
        self.run_job()
        self.mocks["send_media"].assert_called_once()

    def test_off_mode_keeps_transcribing_but_never_sends_audio(self):
        self.settings["replyWithAudio"] = "off"
        self.run_job(**self.voice_note())
        self.mocks["send_media"].assert_not_called()
        self.mocks["transcribe"].assert_called_once()

    def test_without_a_provider_the_voice_note_reaches_the_agent_as_it_always_did(self):
        self.settings["provider"] = "none"
        seen = []
        self.mocks["invoke_agent"].side_effect = lambda job: seen.append(job["text"]) or self.result
        self.run_job(**self.voice_note())
        self.assertEqual(seen, ["[Audio]"])
        self.mocks["transcribe"].assert_not_called()
        self.mocks["send_media"].assert_not_called()

    def test_an_unreadable_voice_note_asks_the_customer_to_write(self):
        self.mocks["transcribe"].return_value = ""
        self.assertEqual(self.run_job(**self.voice_note()), "audio_unreadable")
        self.mocks["invoke_agent"].assert_not_called()
        self.assertIn("No pude entender", self.mocks["send_text"].call_args.args[1])

    def test_a_failed_transcription_is_the_same(self):
        self.mocks["transcribe"].side_effect = transcription.TranscriptionFailed("boom")
        self.assertEqual(self.run_job(**self.voice_note()), "audio_unreadable")

    def test_a_failed_audio_answer_never_fails_the_turn(self):
        self.mocks["synthesize"].side_effect = RuntimeError("Polly down")
        self.assertEqual(self.run_job(**self.voice_note()), "answered")
        self.mocks["send_text"].assert_called_once()
        self.mocks["send_media"].assert_not_called()

    def test_a_person_who_took_over_is_not_transcribed_for(self):
        self.mocks["get_conversation"].return_value = self.support.open_conversation(mode="human")
        self.assertEqual(self.run_job(**self.voice_note()), "skipped_human")
        self.mocks["transcribe"].assert_not_called()


class TranscriptionPollingTest(unittest.TestCase):
    def setUp(self):
        self.client = mock.MagicMock()
        patches = [
            mock.patch.object(transcription, "_client", self.client),
            mock.patch.object(transcription.media, "MEDIA_BUCKET_NAME", "bucket"),
            mock.patch.object(transcription.time, "sleep"),
            mock.patch.object(voice, "read", return_value={**voice.DEFAULTS, "transcribeLanguage": "es-US"}),
        ]
        for patcher in patches:
            patcher.start()
        self.addCleanup(mock.patch.stopall)

    def job(self, status, **extra):
        return {"TranscriptionJob": {"TranscriptionJobStatus": status, **extra}}

    def test_a_voice_note_becomes_text_and_the_job_is_deleted(self):
        self.client.get_transcription_job.side_effect = [
            self.job("IN_PROGRESS"),
            self.job("COMPLETED", Transcript={"TranscriptFileUri": "https://example/t.json"}),
        ]
        with mock.patch.object(transcription, "_fetch", return_value="hola, tienen despacho"):
            self.assertEqual(transcription.transcribe("media/a.ogg", "audio/ogg; codecs=opus"), "hola, tienen despacho")
        started = self.client.start_transcription_job.call_args.kwargs
        self.assertEqual(started["MediaFormat"], "ogg")
        self.assertEqual(started["Media"]["MediaFileUri"], "s3://bucket/media/a.ogg")
        self.assertTrue(started["TranscriptionJobName"].startswith(transcription.JOB_NAME_PREFIX))
        self.client.delete_transcription_job.assert_called_once()

    def test_a_failed_job_is_an_error_and_is_still_deleted(self):
        self.client.get_transcription_job.return_value = self.job("FAILED", FailureReason="bad audio")
        with self.assertRaises(transcription.TranscriptionFailed):
            transcription.transcribe("media/a.ogg")
        self.client.delete_transcription_job.assert_called_once()

    def test_a_job_that_takes_too_long_is_an_error(self):
        self.client.get_transcription_job.return_value = self.job("IN_PROGRESS")
        with mock.patch.object(transcription, "MAX_WAIT_SECONDS", -1), self.assertRaises(transcription.TranscriptionFailed):
            transcription.transcribe("media/a.ogg")

    def test_no_stored_audio_is_an_error(self):
        with self.assertRaises(transcription.TranscriptionFailed):
            transcription.transcribe("")

    def test_the_length_of_a_voice_note_comes_from_its_last_word(self):
        self.assertEqual(transcription.spoken_seconds({"items": [{"end_time": "1.2"}, {"end_time": "4.8"}, {}]}), 4.8)
        self.assertEqual(transcription.spoken_seconds({}), 0.0)


if __name__ == "__main__":
    unittest.main()
