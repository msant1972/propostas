variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "environment" {
  type        = string
  description = "dev, qa ou prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "instance_type" {
  type    = string
  default = "m7i.large"
}

variable "data_volume_gb" {
  type    = number
  default = 100
}

variable "certificate_arn" {
  type        = string
  description = "Certificado ACM para o listener HTTPS do ALB"
}

variable "alarm_email" {
  type        = string
  description = "Destino dos alarmes do CloudWatch"
}
