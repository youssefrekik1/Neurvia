"""Verify configured Gemini models with synthetic input and report sanitized results."""
from io import BytesIO
import json

from PIL import Image, ImageDraw

from app.ai.client import ModelConfigurationError, ModelRequestFailed
from app.ai.gemini import GeminiClient, GeminiDocumentModels
from app.core.config import Settings


def main():
    settings = Settings()
    if settings.model_backend != "gemini":
        raise SystemExit("Sélectionnez MODEL_BACKEND=gemini avant ce test.")
    client = GeminiClient(settings)
    documents = GeminiDocumentModels(client)
    try:
        for model in dict.fromkeys((settings.llm_model, settings.document_vision_model,
                                    settings.gemini_diagnosis_model, settings.embedding_model)):
            print(client.cache_revision(model), flush=True)
        schema = {"type": "object", "properties": {"answer": {"type": "integer"}}, "required": ["answer"]}
        messages = [{"role": "user", "content": "Return the sum of 2 and 3 as the integer answer."}]
        for model in dict.fromkeys((settings.llm_model, settings.gemini_diagnosis_model)):
            if json.loads(client.generate_json(model, messages, schema)).get("answer") != 5:
                raise ValueError("unexpected_structured_answer")
            print(f"{model}: structured JSON OK")
        image = Image.new("RGB", (400, 120), "white")
        ImageDraw.Draw(image).text((20, 30), "INDEX = 42", fill="black", font_size=25)
        data = BytesIO()
        image.save(data, format="PNG")
        if not any("42" in block.text for block in documents.transcribe(data.getvalue()).blocks):
            raise ValueError("unexpected_page_transcription")
        vectors = documents.embed(["A list starts at index zero.", "A loop repeats."], documents.revision())
        print(f"Vision OK. Embeddings OK: {len(vectors)} vectors, {len(vectors[0])} dimensions.")
    except (ModelConfigurationError, ModelRequestFailed) as exc:
        raise SystemExit(str(exc)) from None
    except (ValueError, TypeError) as exc:
        raise SystemExit(f"Gemini response validation failed: {type(exc).__name__}") from None
    finally:
        client.close()


if __name__ == "__main__":
    main()
