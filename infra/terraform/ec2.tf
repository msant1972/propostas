data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_security_group" "app" {
  name_prefix = "cpq-${var.environment}-app-"
  vpc_id      = aws_vpc.main.id
  ingress {
    description     = "HTTP do ALB (Nginx)"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "app" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
  }
  statement {
    actions   = ["s3:PutObject", "s3:PutObjectRetention"] # só acrescenta; não lê nem apaga
    resources = ["${aws_s3_bucket.audit.arn}/*"]
  }
}

resource "aws_iam_role" "app" {
  name_prefix        = "cpq-${var.environment}-app-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "app" {
  name_prefix = "cpq-${var.environment}-app-"
  role        = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  monitoring             = true

  metadata_options {
    http_tokens = "required" # IMDSv2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 40
    encrypted   = true
    kms_key_id  = aws_kms_key.main.arn
  }

  lifecycle {
    ignore_changes = [ami] # as atualizações fazem-se por Ansible, não por substituição da instância
  }
  tags = { Name = "cpq-${var.environment}-app" }
}

# Volume dedicado da MariaDB: sobrevive à instância e é a base do restauro.
resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.app.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  kms_key_id        = aws_kms_key.main.arn
  tags              = { Name = "cpq-${var.environment}-mariadb" }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

resource "aws_backup_vault" "main" {
  name        = "cpq-${var.environment}"
  kms_key_arn = aws_kms_key.main.arn
}

resource "aws_backup_plan" "daily" {
  name = "cpq-${var.environment}-diario"
  rule {
    rule_name         = "snapshots-ebs"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 * * ? *)"
    lifecycle {
      delete_after = 35
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name_prefix        = "cpq-${var.environment}-backup-"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "ebs" {
  name         = "volumes-cpq"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [aws_ebs_volume.data.arn, "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:volume/*"]
  condition {
    string_equals {
      key   = "aws:ResourceTag/Project"
      value = "cpq-propostas"
    }
  }
}

data "aws_caller_identity" "current" {}
