# vmui — helpers for Windows guest credentials.
#
# - `New-VmuiPassword` returns a strong 16-char password that satisfies the
#   default Win11 complexity policy (mixed case + digits + symbol).
# - `Resolve-VmuiCredential` returns a [pscredential]-shaped @{Username; Password}
#   hashtable. If both inputs are blank, generates a random password. If only
#   the password is blank AND the username is the default "dragos", uses the
#   password from .private/credentials.env (matches the existing dev VM).

# Guest credentials come from .private/credentials.env (gitignored).
. "$PSScriptRoot\guest-credentials.ps1"

function New-VmuiPassword {
  [CmdletBinding()]
  param([int]$Length = 16)

  # Excludes ambiguous chars (0/O, 1/l/I, |) to make the password readable
  # when typed at the Hyper-V console.
  $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  $lower = 'abcdefghijkmnpqrstuvwxyz'
  $digit = '23456789'
  $sym   = '!@#$%^&*-_=+'

  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)

  # Force-include at least one of each class so the resulting string passes
  # the Windows password complexity policy on every attempt.
  $chars = @(
    $upper[$bytes[0] % $upper.Length],
    $lower[$bytes[1] % $lower.Length],
    $digit[$bytes[2] % $digit.Length],
    $sym[$bytes[3]   % $sym.Length]
  )
  $pool = ($upper + $lower + $digit + $sym).ToCharArray()
  for ($i = 4; $i -lt $Length; $i++) {
    $chars += $pool[$bytes[$i] % $pool.Length]
  }
  # Fisher-Yates shuffle so required-class chars aren't always at the front.
  for ($i = $Length - 1; $i -gt 0; $i--) {
    $j = $bytes[$i] % ($i + 1)
    $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
  }
  -join $chars
}

function Resolve-VmuiCredential {
  [CmdletBinding()]
  param(
    [string]$Username,
    [string]$Password
  )
  if (-not $Username) { $Username = 'dragos' }
  if (-not $Password) {
    if ($Username -eq 'dragos') {
      # Match the legacy WSL/QEMU dev VM so existing notes work.
      $Password = $env:WIN_GUEST_PASS
    } else {
      $Password = New-VmuiPassword
    }
  }
  [pscustomobject]@{ Username = $Username; Password = $Password }
}
