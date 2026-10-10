output "alb_dns_name" { value = aws_lb.main.dns_name }
output "instance_id" { value = aws_instance.app.id }
output "backups_bucket" { value = aws_s3_bucket.backups.bucket }
output "audit_bucket" { value = aws_s3_bucket.audit.bucket }
output "kms_key_arn" { value = aws_kms_key.main.arn }
