#!/usr/bin/env python3
from pathlib import Path
import json
import sys


EVIDENCE = Path(__file__).resolve().with_name("lsp-evidence.jsonl")
DOCUMENTS = {}


def record(event, **fields):
    entry = {"event": event, **fields}
    with EVIDENCE.open("a", encoding="utf-8") as stream:
        stream.write(
            json.dumps(
                entry,
                sort_keys=True,
                ensure_ascii=False,
            )
            + "\n"
        )
        stream.flush()


def read_message():
    headers = {}

    while True:
        line = sys.stdin.buffer.readline()

        if not line:
            return None

        if line in (b"\r\n", b"\n"):
            break

        decoded = line.decode("ascii").strip()
        if ":" not in decoded:
            continue

        name, value = decoded.split(":", 1)
        headers[name.lower()] = value.strip()

    length = int(headers.get("content-length", "0"))
    if length <= 0:
        return None

    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        return None

    return json.loads(payload.decode("utf-8"))


def send(payload):
    encoded = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")

    sys.stdout.buffer.write(
        ("Content-Length: %d\r\n\r\n" % len(encoded)).encode("ascii")
    )
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def respond(message_id, result):
    send(
        {
            "jsonrpc": "2.0",
            "id": message_id,
            "result": result,
        }
    )


def document_end(text):
    lines = text.split("\n")
    return {
        "line": len(lines) - 1,
        "character": len(lines[-1]),
    }


def apply_full_change(params):
    document = params.get("textDocument") or {}
    uri = document.get("uri")
    version = document.get("version")

    changes = params.get("contentChanges") or []
    if not uri or not changes:
        return

    change = changes[-1]
    text = change.get("text")
    if not isinstance(text, str):
        return

    DOCUMENTS[uri] = {
        "text": text,
        "version": version,
    }

    record(
        "didChange",
        uri=uri,
        version=version,
        text=text,
    )


def handle(message):
    method = message.get("method")
    message_id = message.get("id")
    params = message.get("params") or {}

    if method == "initialize":
        record("initialize")
        respond(
            message_id,
            {
                "capabilities": {
                    "textDocumentSync": {
                        "openClose": True,
                        "change": 1,
                    },
                    "documentFormattingProvider": True,
                },
                "serverInfo": {
                    "name": "LM011-D2 formatting test server",
                    "version": "1",
                },
            },
        )
        return True

    if method == "initialized":
        record("initialized")
        return True

    if method == "textDocument/didOpen":
        document = params.get("textDocument") or {}
        uri = document.get("uri")
        text = document.get("text")
        version = document.get("version")

        if uri and isinstance(text, str):
            DOCUMENTS[uri] = {
                "text": text,
                "version": version,
            }

        record(
            "didOpen",
            uri=uri,
            version=version,
            text=text,
        )
        return True

    if method == "textDocument/didChange":
        apply_full_change(params)
        return True

    if method == "textDocument/formatting":
        document = params.get("textDocument") or {}
        uri = document.get("uri")
        state = DOCUMENTS.get(
            uri,
            {
                "text": "",
                "version": None,
            },
        )
        text = state["text"]

        record(
            "formatting",
            uri=uri,
            version=state["version"],
            text=text,
        )

        edits = []
        if text != "value: 1\n":
            edits = [
                {
                    "range": {
                        "start": {
                            "line": 0,
                            "character": 0,
                        },
                        "end": document_end(text),
                    },
                    "newText": "value: 1\n",
                }
            ]

        respond(message_id, edits)
        return True

    if method == "shutdown":
        record("shutdown")
        respond(message_id, None)
        return True

    if method == "exit":
        record("exit")
        return False

    if message_id is not None:
        respond(message_id, None)

    return True


def main():
    if sys.argv[1:] != ["language-server"]:
        print(
            "LM011-D2 test runtime expects exactly: language-server",
            file=sys.stderr,
        )
        return 2

    if EVIDENCE.exists():
        EVIDENCE.unlink()

    record("serverStart", argv=sys.argv[1:])

    while True:
        message = read_message()
        if message is None:
            break

        if not handle(message):
            break

    record("serverStop")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
