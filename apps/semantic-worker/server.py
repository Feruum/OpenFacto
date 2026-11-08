"""Bounded loopback inference service; it never downloads code/models while serving."""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from models import encode, load


def serve(name, port):
    embedding, metadata = load(name)
    reranker, rerank_metadata = load("reranker")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *_args):
            pass  # Queries and document text are private.

        def reply(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/health":
                return self.reply(404, {"error": "not_found"})
            self.reply(200, {"status": "ready", **metadata, "dimensions": 384,
                             "reranker": rerank_metadata, "device": "cpu"})

        def do_POST(self):
            if self.headers.get("Origin") or self.headers.get("Transfer-Encoding"):
                return self.reply(403, {"error": "browser_requests_not_allowed"})
            if self.path not in ("/v1/embeddings", "/v1/rerank"):
                return self.reply(404, {"error": "not_found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 512_000:
                    return self.reply(413, {"error": "body_limit"})
                data = json.loads(self.rfile.read(length))
                if self.path == "/v1/embeddings":
                    texts = data["input"]
                    if data.get("model") != metadata["model"] or data.get("revision") != metadata["revision"]:
                        return self.reply(409, {"error": "model_mismatch"})
                    kind = data.get("input_type", "passage")
                    if kind not in ("query", "passage"):
                        raise ValueError("input_type")
                else:
                    texts = data["documents"]
                    query = data["query"]
                    if not isinstance(query, str) or not 0 < len(query) <= 4000:
                        raise ValueError("query")
                if not isinstance(texts, list) or not 1 <= len(texts) <= 32 or any(
                    not isinstance(t, str) or not 0 < len(t) <= 4000 for t in texts
                ):
                    raise ValueError("texts")
                if not lock.acquire(timeout=20):
                    return self.reply(503, {"error": "busy"})
                try:
                    if self.path == "/v1/embeddings":
                        vectors = encode(embedding, name, texts, kind).tolist()
                        result = {**metadata, "data": [{"index": i, "embedding": v} for i, v in enumerate(vectors)]}
                    else:
                        scores = reranker.predict([(query, t) for t in texts], batch_size=8, show_progress_bar=False).tolist()
                        result = {**rerank_metadata, "results": [{"index": i, "score": s} for i, s in enumerate(scores)]}
                finally:
                    lock.release()
                self.reply(200, result)
            except (ValueError, KeyError, TypeError):
                self.reply(400, {"error": "invalid_request"})
            except Exception:
                self.reply(503, {"error": "inference_unavailable"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(json.dumps({"listening": f"http://127.0.0.1:{port}", **metadata}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["e5", "minilm"], default="e5")
    parser.add_argument("--port", type=int, default=7312)
    args = parser.parse_args()
    serve(args.model, args.port)
