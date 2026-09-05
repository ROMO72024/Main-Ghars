$ErrorActionPreference = "Stop"

$keyFile = Join-Path $PSScriptRoot "ghars-upload-key.jks"
if (Test-Path $keyFile) {
  throw "الملف موجود مسبقاً: $keyFile. احتفظ به ولا تنشئ مفتاحاً آخر للتطبيق نفسه."
}

keytool -genkeypair `
  -v `
  -keystore $keyFile `
  -alias ghars-upload `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -dname "CN=Ghars Modern School, OU=Digital, O=Ghars, L=Gaza, C=PS"

Write-Host "تم إنشاء مفتاح الرفع في: $keyFile"
Write-Host "احفظه مع كلمة مروره في مكانين آمنين. لا ترفعه إلى GitHub."
