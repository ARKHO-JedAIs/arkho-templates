# The agent image: one image, two runtimes.
#
# - Bedrock AgentCore Runtime (default CMD): the BedrockAgentCoreApp server on
#   port 8080 (/invocations, /ping), instrumented with ADOT so traces reach
#   CloudWatch GenAI observability.
# - Lambda: override the command with the handler, "lambda_handler.handler".
#   Inside Lambda (AWS_LAMBDA_RUNTIME_API is set) the entrypoint starts the
#   AWS Lambda Runtime Interface Client with that handler instead of the
#   command; outside Lambda the command runs as is.
#
# AgentCore Runtime requires linux/arm64; build with
#   docker build --platform linux/arm64 -t agent .
FROM --platform=linux/arm64 python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DOCKER_CONTAINER=1 \
    OTEL_TRACES_SAMPLER=always_on

WORKDIR /app

# ADOT and the Lambda runtime client are runtime launchers, never imported by
# the code, so they are pinned here instead of in requirements.txt.
COPY requirements.txt .
RUN pip install -r requirements.txt aws-opentelemetry-distro==0.19.0 awslambdaric==4.2.3

COPY src/ .

RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin agent
USER agent

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "-c", "if [ -n \"$AWS_LAMBDA_RUNTIME_API\" ]; then case \"$0\" in *.*) exec python -m awslambdaric \"$0\";; *) exec python -m awslambdaric lambda_handler.handler;; esac; fi; exec \"$0\" \"$@\""]
CMD ["opentelemetry-instrument", "python", "agentcore_main.py"]
