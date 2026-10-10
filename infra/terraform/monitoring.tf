resource "aws_sns_topic" "alarms" {
  name = "cpq-${var.environment}-alarmes"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Recuperação automática da instância em falha de hardware (os volumes EBS mantêm-se).
resource "aws_cloudwatch_metric_alarm" "recover" {
  alarm_name          = "cpq-${var.environment}-recuperar-instancia"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 2
  dimensions          = { InstanceId = aws_instance.app.id }
  alarm_actions       = ["arn:aws:automate:${var.region}:ec2:recover", aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "cpq-${var.environment}-erros-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  alarm_name          = "cpq-${var.environment}-alvo-nao-saudavel"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 3
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.app.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

# Métricas publicadas pelo agente CloudWatch / OpenTelemetry (ver infra/ansible).
resource "aws_cloudwatch_metric_alarm" "disk" {
  alarm_name          = "cpq-${var.environment}-disco-cheio"
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "cpq-${var.environment}-memoria"
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 90
  period              = 300
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
