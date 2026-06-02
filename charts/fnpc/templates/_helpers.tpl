{{- define "fnpc.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "fnpc.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "fnpc.labels" -}}
app.kubernetes.io/name: {{ include "fnpc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "fnpc.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fnpc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
