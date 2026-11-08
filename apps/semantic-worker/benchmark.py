"""Retrieval evaluation, not an LLM-answer-quality score. Synthetic labels need human review."""
import argparse
import gc
import json
import time
import re
import unicodedata
from pathlib import Path

import numpy as np
from models import ROOT, encode, load


def metrics(ranks, categories):
    def score(values):
        return {"count": len(values), "recall@1": sum(r == 1 for r in values) / len(values),
                "recall@3": sum(r <= 3 for r in values) / len(values),
                "mrr": sum(1 / r for r in values) / len(values)}
    return {"overall": score(ranks), "byCategory": {c: score([r for r, k in zip(ranks, categories) if k == c]) for c in sorted(set(categories))}}


def local_baseline(texts, queries, expected, categories):
    def vector(text):
        values = np.zeros(256)
        for word in re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", text).lower()):
            word = "^" + word + "$"
            for offset in range(len(word) - 2):
                hashed = 2166136261
                for character in word[offset:offset + 3]:
                    hashed = ((hashed ^ ord(character)) * 16777619) & 0xffffffff
                values[hashed % 256] += 1 if hashed > 0x7fffffff else -1
        return values / max(np.linalg.norm(values), 1e-12)
    scores = np.array([vector(q) for q in queries]) @ np.array([vector(t) for t in texts]).T
    order = np.argsort(-scores, axis=1)
    return metrics([list(row).index(e) + 1 for row, e in zip(order, expected)], categories)


def main(output, baseline_only=False):
    corpus = json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))
    docs = corpus["documents"]
    texts = [d["title"] + "\n" + d["text"] for d in docs]
    queries = [q for d in docs for q in d["queries"]]
    expected = [i for i, d in enumerate(docs) for _ in d["queries"]]
    categories = corpus["queryCategories"] * len(docs)
    results = {"corpus": corpus["version"], "reviewStatus": corpus["reviewStatus"], "models": {}}
    baseline = local_baseline(texts, queries, expected, categories)
    if baseline_only:
        results = json.loads(Path(output).read_text(encoding="utf-8"))
        results["baseline"] = baseline
        Path(output).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"baseline": baseline["overall"]}), flush=True)
        return
    results["baseline"] = baseline
    rankings = {}
    for name in ("e5", "minilm"):
        model, metadata = load(name)
        started = time.perf_counter()
        document_vectors = encode(model, name, texts, "passage")
        query_vectors = encode(model, name, queries, "query")
        scores = query_vectors @ document_vectors.T
        order = np.argsort(-scores, axis=1)
        rankings[name] = order
        ranks = [list(row).index(label) + 1 for row, label in zip(order, expected)]
        results["models"][name] = {**metadata, **metrics(ranks, categories), "durationSeconds": time.perf_counter() - started,
                                    "misses": [{"query": q, "expected": docs[e]["id"], "actual": docs[int(row[0])]["id"]} for q, e, row in zip(queries, expected, order) if row[0] != e]}
        print(json.dumps({name: results["models"][name]["overall"]}), flush=True)
        del model
        gc.collect()
    winner = max(results["models"], key=lambda key: (results["models"][key]["overall"]["recall@1"], results["models"][key]["overall"]["mrr"]))
    reranker, metadata = load("reranker")
    order = rankings[winner]
    pairs = [(q, texts[int(i)]) for q, row in zip(queries, order) for i in row[:5]]
    started = time.perf_counter()
    scores = reranker.predict(pairs, batch_size=8, show_progress_bar=False).reshape(len(queries), 5)
    reranked = [list(row[:5][np.argsort(-s)]) + list(row[5:]) for row, s in zip(order, scores)]
    results["reranker"] = {**metadata, **metrics([row.index(e) + 1 for row, e in zip(reranked, expected)], categories), "durationSeconds": time.perf_counter() - started}
    results["selectedEmbedding"] = winner
    results["enableReranker"] = results["reranker"]["overall"]["recall@1"] > results["models"][winner]["overall"]["recall@1"] and all(
        results["reranker"]["byCategory"][c]["recall@1"] >= results["models"][winner]["byCategory"][c]["recall@1"] for c in ("kk", "mixed"))
    Path(output).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selected": winner, "enableReranker": results["enableReranker"], "reranker": results["reranker"]["overall"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(ROOT / "benchmark-results.json"))
    parser.add_argument("--baseline-only", action="store_true")
    args = parser.parse_args()
    main(args.output, args.baseline_only)
