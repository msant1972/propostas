resource "aws_kms_key" "main" {
  description             = "cpq-${var.environment}: EBS, S3 e Secrets Manager"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "main" {
  name          = "alias/cpq-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}

resource "aws_s3_bucket" "backups" {
  bucket_prefix = "cpq-${var.environment}-backups-"
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expira-backups-antigos"
    status = "Enabled"
    filter {}
    expiration {
      days = 35
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# Cópia imutável da auditoria: Object Lock em modo compliance, nem o administrador a reescreve.
resource "aws_s3_bucket" "audit" {
  bucket_prefix       = "cpq-${var.environment}-audit-"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Segredos: os valores são preenchidos fora do Terraform (nunca em código nem em estado).
resource "aws_secretsmanager_secret" "app" {
  for_each   = toset(["entra-certificate", "mariadb-app", "mariadb-encryption-key", "signature-provider"])
  name       = "cpq/${var.environment}/${each.key}"
  kms_key_id = aws_kms_key.main.arn
}
