import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mode: str = os.getenv("NF_MODE", "production")
    ai_mode: str = os.getenv("NF_AI_MODE", "live")
    project: str = os.getenv("GCLOUD_PROJECT", "demo-novelforge")
    bucket: str = os.getenv(
        "FIREBASE_STORAGE_BUCKET",
        os.getenv("GCLOUD_PROJECT", "demo-novelforge") + ".appspot.com",
    )
    origin: str = os.getenv("APP_ORIGIN", "http://localhost:3000")


settings = Settings()


def validate_config():
    if settings.mode != "emulator" and any(
        os.getenv(k)
        for k in [
            "FIREBASE_AUTH_EMULATOR_HOST",
            "FIRESTORE_EMULATOR_HOST",
            "STORAGE_EMULATOR_HOST",
        ]
    ):
        raise RuntimeError("Emulator hosts are forbidden in production mode")
    if settings.mode == "emulator":
        if not settings.project.startswith("demo-"):
            raise RuntimeError("Local development must use a demo- project")
        for name in [
            "FIREBASE_AUTH_EMULATOR_HOST",
            "FIRESTORE_EMULATOR_HOST",
            "STORAGE_EMULATOR_HOST",
        ]:
            if "127.0.0.1:" not in os.getenv(name, ""):
                raise RuntimeError(f"{name} must point to the local emulator")
    elif settings.project.startswith("demo-"):
        raise RuntimeError("Production requires an actual GCLOUD_PROJECT")
    elif settings.ai_mode != "live":
        raise RuntimeError("Mock AI is forbidden in production")
