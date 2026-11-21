from collections.abc import Iterator
from contextlib import closing
from functools import cached_property

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import Settings


class ObjectStore:
    """Private S3 storage. Every read is authorized by a relational record first."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self.bucket = settings.document_s3_bucket

    @cached_property
    def client(self):
        settings = self._settings
        return boto3.client(
            "s3", endpoint_url=settings.document_s3_endpoint, region_name=settings.document_s3_region,
            aws_access_key_id=settings.document_s3_access_key.get_secret_value(),
            aws_secret_access_key=settings.document_s3_secret_key.get_secret_value(),
            config=Config(s3={"addressing_style": "path"}, connect_timeout=4, read_timeout=20,
                          retries={"mode": "standard", "total_max_attempts": 3}),
        )

    def ensure_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            if exc.response["Error"]["Code"] not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except ClientError as create_error:
                if create_error.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
                    raise

    def put(self, key: str, data: bytes, media_type: str):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=media_type)

    def read(self, key: str, limit: int) -> bytes:
        result = self.client.get_object(Bucket=self.bucket, Key=key)
        with closing(result["Body"]) as stream:
            value = stream.read(limit + 1)
        if len(value) > limit:
            raise ValueError("Object exceeds its configured size limit")
        return value

    def fetch(self, key: str):
        return self.client.get_object(Bucket=self.bucket, Key=key)

    @staticmethod
    def stream(result) -> Iterator[bytes]:
        with closing(result["Body"]) as stream:
            yield from stream.iter_chunks(chunk_size=128 * 1024)
