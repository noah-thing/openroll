# OpenRoll installer for Windows.
#
#   irm https://raw.githubusercontent.com/noah-thing/openroll/main/install.ps1 | iex
#
# Set $env:OPENROLL_VERSION (e.g. v0.1.0) first to install a specific release.

# irm | iex runs in the person's own session: keep every setting change inside this block and put the TLS one back
$oldTls = [Net.ServicePointManager]::SecurityProtocol
try {
	& {
		$ErrorActionPreference = 'Stop'
		$ProgressPreference = 'SilentlyContinue'

		# Windows PowerShell 5.1 starts with TLS 1.0/1.1 only, which GitHub refuses
		[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

		$repo = 'noah-thing/openroll'
		$api = if ($env:OPENROLL_VERSION) { "https://api.github.com/repos/$repo/releases/tags/v$($env:OPENROLL_VERSION.TrimStart('v'))" } else { "https://api.github.com/repos/$repo/releases/latest" }
		$headers = @{ 'User-Agent' = 'openroll-installer'; 'Accept' = 'application/vnd.github+json' }

		Write-Host 'Finding the latest OpenRoll release' -ForegroundColor White
		$release = Invoke-RestMethod $api -Headers $headers
		$asset = @($release.assets) | Where-Object { $_.name -like 'OpenRoll-Setup-*-win-x64.exe' } | Select-Object -First 1
		$sums = @($release.assets) | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
		if ($release.draft -or -not $asset) { throw 'This release has no build for Windows yet.' }
		if (-not $sums) { throw 'This release has no SHA256SUMS.txt, so its files cannot be checked.' }

		$file = Join-Path ([IO.Path]::GetTempPath()) $asset.name
		Write-Host "Downloading $($asset.name)"
		Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing -Headers $headers

		# The same list the in app updater trusts
		$list = (Invoke-WebRequest $sums.browser_download_url -UseBasicParsing -Headers $headers).Content
		if ($list -is [byte[]]) { $list = [Text.Encoding]::UTF8.GetString($list) }
		$line = ($list -split "`n") | Where-Object { $_ -match "^([0-9a-fA-F]{64}) +\*?$([regex]::Escape($asset.name))\s*$" } | Select-Object -First 1
		if (-not $line) { Remove-Item -LiteralPath $file -Force; throw "$($asset.name) is not listed in SHA256SUMS.txt." }
		$want = ($line -split ' ')[0]
		$got = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
		if ($got -ne $want) {
			Remove-Item -LiteralPath $file -Force
			throw "$($asset.name) does not match its checksum; nothing was installed."
		}

		Write-Host 'Installing' -ForegroundColor White
		# The per user setup needs no administrator rights.
		$p = Start-Process $file -ArgumentList '/S' -Wait -PassThru
		Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
		if ($p.ExitCode -ne 0) { throw "The installer stopped with exit code $($p.ExitCode)." }

		Write-Host ''
		Write-Host "OpenRoll $($release.tag_name) is installed. Find it in the Start menu."
	}
} finally {
	[Net.ServicePointManager]::SecurityProtocol = $oldTls
}
