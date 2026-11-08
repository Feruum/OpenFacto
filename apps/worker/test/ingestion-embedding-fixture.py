"""Local-only benchmark fixture for the pinned multilingual MiniLM ONNX weights.

uv run --with onnxruntime==1.24.4 --with tokenizers==0.22.2 ingestion-embedding-fixture.py MODEL TOKENIZER
"""

import argparse
import hashlib
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
import onnxruntime
from tokenizers import Tokenizer

MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_SHA = "98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f"
TOKENIZER_SHA = "2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8"


def checked(path, expected):
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise ValueError("Pinned fixture checksum mismatch")
    return str(path)


def main():
    args = argparse.ArgumentParser()
    args.add_argument("model", type=Path)
    args.add_argument("tokenizer", type=Path)
    args.add_argument("--port", type=int, default=58082)
    config = args.parse_args()
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = onnxruntime.InferenceSession(
        checked(config.model, MODEL_SHA), options, providers=["CPUExecutionProvider"]
    )
    tokenizer = Tokenizer.from_file(checked(config.tokenizer, TOKENIZER_SHA))
    tokenizer.enable_padding(pad_id=tokenizer.token_to_id("<pad>"), pad_token="<pad>")
    tokenizer.enable_truncation(max_length=128)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/v1/embeddings":
                return self.send_error(404)
            try:
                self.connection.settimeout(10)
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 256 * 1024:
                    return self.send_error(413)
                body = json.loads(self.rfile.read(length))
                texts = body["input"]
                if (body["model"] != MODEL_ID or not isinstance(texts, list)
                        or not 1 <= len(texts) <= 16
                        or any(not isinstance(t, str) or len(t) > 4000 for t in texts)):
                    return self.send_error(400)
                batch = tokenizer.encode_batch(texts)
                feed = {
                    "input_ids": np.array([t.ids for t in batch], dtype=np.int64),
                    "attention_mask": np.array([t.attention_mask for t in batch], dtype=np.int64),
                    "token_type_ids": np.array([t.type_ids for t in batch], dtype=np.int64),
                }
                hidden = session.run(None, {v.name: feed[v.name] for v in session.get_inputs()})[0]
                mask = feed["attention_mask"][:, :, None]
                vectors = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
                data = [{"index": i, "embedding": v.tolist()} for i, v in enumerate(vectors)]
                encoded = json.dumps({"model": MODEL_ID, "data": data}).encode()
            except (ValueError, KeyError, TypeError):
                return self.send_error(400)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format, *args):
            pass

    with HTTPServer(("127.0.0.1", config.port), Handler) as server:
        print("Local embedding fixture ready", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
