"""WhatsApp helpers shared by the functions under src/lambda/whatsapp.

Messages travel through AWS End User Messaging Social: what a contact writes
arrives as an SNS notification (ws-handler) and what we send goes out with
``socialmessaging.send_whatsapp_message``. Every exchange is stored in
DynamoDB and announced on the AppSync realtime API, so the front sees it live.

Split by concern so each function imports only what it uses:

* ``config``    - the WhatsApp configuration parameter (ids, prefix, auto reply)
* ``store``     - the conversations and messages tables
* ``messaging`` - sending text, media and templates; listing, creating,
  editing and deleting templates
* ``templates`` - checking a template against Meta's rules and building its
  definition
* ``media``     - the media bucket: downloads, uploads, presigned URLs and
  template header samples
* ``realtime``  - publishing events to AppSync
* ``http``      - request parsing shared by the API handlers
* ``agent``     - the AI agent's queue, rate limit, sessions and handoff
"""
