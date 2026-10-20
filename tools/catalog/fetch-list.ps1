# Download every entry of a list JSON, unpack archives, and collect the game JAR per entry.
# usage: fetch-list.ps1 -List list.json -Out D:\...\dir
param([string]$List, [string]$Out)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$entries = Get-Content $List -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force "$Out\jars" | Out-Null
$report = @()
foreach ($e in $entries) {
	$dir = "$Out\raw\$($e.id)"
	New-Item -ItemType Directory -Force $dir | Out-Null
	$file = "$dir\download.bin"
	$status = 'ok'
	try {
		if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 100) {
			Invoke-WebRequest $e.url -OutFile $file -UserAgent 'Wget/1.21.4' -MaximumRedirection 10 -TimeoutSec 120 -UseBasicParsing
		}
	} catch { $status = 'download failed: ' + $_.Exception.Message }
	$jar = $null
	if ($status -eq 'ok') {
		$b = [IO.File]::ReadAllBytes($file)
		$isZip = $b.Length -gt 4 -and $b[0] -eq 0x50 -and $b[1] -eq 0x4B
		$isHtml = $b.Length -gt 15 -and ([Text.Encoding]::ASCII.GetString($b, 0, 15) -match '<!DOCTYPE|<html')
		if ($isHtml) { $status = 'got an HTML page, not a file' }
		else {
			# a JAR is a zip with a manifest / classes at the top level
			$x = "$dir\x"
			if (Test-Path $x) { Remove-Item $x -Recurse -Force }
			New-Item -ItemType Directory -Force $x | Out-Null
			tar -xf $file -C $x 2>$null
			$classes = Get-ChildItem $x -Recurse -Filter *.class -ErrorAction SilentlyContinue | Select -First 1
			$manifest = Test-Path "$x\META-INF\MANIFEST.MF"
			if ($isZip -and ($manifest -or $classes) -and -not (Get-ChildItem $x -Recurse -Filter *.jar | Select -First 1)) { $jar = $file }
			else {
				# archive: pick the best jar inside (prefer MIDP2 builds, skip sources)
				$cands = Get-ChildItem $x -Recurse -Filter *.jar | Where-Object { $_.Name -notmatch 'src|source|lib(J2ME)?\.jar$|proguard|javadoc|test' } | Sort-Object @{e={ if ($_.Name -match 'midp2|MIDP2') {0} else {1} }}, @{e={$_.FullName.Length}}
				if ($cands) { $jar = $cands[0].FullName } else { $status = 'no jar inside archive' }
			}
		}
	}
	if ($jar) { Copy-Item $jar "$Out\jars\$($e.id).jar" -Force }
	$report += [pscustomobject]@{ id = $e.id; status = $status; jar = if ($jar) { Split-Path $jar -Leaf } else { '' } }
	Write-Output ("{0,-22} {1}" -f $e.id, $(if ($jar) { 'jar: ' + (Split-Path $jar -Leaf) } else { $status }))
}
$report | ConvertTo-Json | Set-Content "$Out\fetch-report.json" -Encoding utf8
