"""Pinned, local-only model loading. Downloads happen only in the explicit prepare command."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / "models.lock.json"
MODELS = {
    "e5": "intfloat/multilingual-e5-small",
    "minilm": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "reranker": "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
}
FILES = ["*.json", "model.safetensors", "tokenizer.*", "sentencepiece.bpe.model", "vocab.txt", "1_Pooling/*"]


def prepare():
    from huggingface_hub import HfApi, snapshot_download

    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    for name, repo in MODELS.items():
        revision = lock.get(name, {}).get("revision") or HfApi().model_info(repo).sha
        print(f"Preparing {name}: {repo}@{revision}", flush=True)
        snapshot_download(repo, revision=revision, cache_dir=str(ROOT / ".models"),
                          allow_patterns=FILES)
        lock[name] = {"model": repo, "revision": revision}
        LOCK.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")


def load(name):
    import torch
    from huggingface_hub import snapshot_download
    from sentence_transformers import CrossEncoder, SentenceTransformer

    torch.set_num_threads(4)
    entry = json.loads(LOCK.read_text(encoding="utf-8"))[name]
    path = snapshot_download(entry["model"], revision=entry["revision"],
                             cache_dir=str(ROOT / ".models"), local_files_only=True, allow_patterns=FILES)
    factory = CrossEncoder if name == "reranker" else SentenceTransformer
    model = factory(path, device="cpu", local_files_only=True, trust_remote_code=False)
    if name != "reranker":
        model.max_seq_length = 512 if name == "e5" else 128
    return model, entry


def encode(model, name, texts, kind):
    prefix = ("query: " if kind == "query" else "passage: ") if name == "e5" else ""
    return model.encode([prefix + text for text in texts], batch_size=16,
                        normalize_embeddings=True, show_progress_bar=False)


if __name__ == "__main__":
    prepare()
