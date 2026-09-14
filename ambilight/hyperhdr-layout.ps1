# Dot-source. LED geometry generators for HyperHDR `leds` arrays.
# Each LED is a rectangle in normalized screen space: hmin/hmax/vmin/vmax.

function New-WallCompensation {
    <#
    .SYNOPSIS HyperHDR `color` section that pre-compensates for a painted wall.
    .DESCRIPTION Light bounced off a coloured wall is multiplied by the wall's
      reflectance, so a white LED on an ocean-blue wall (#439ebf) reads blue.
      We scale the channels by the inverse reflectance (normalised so the
      strongest channel stays at 1.0), which restores the screen's hue as the
      eye sees it on the wall. `Strength` 0..1 blends between none and full.
    .PARAMETER WallHex  e.g. '#439ebf'. White wall = no-op.
    #>
    param([string]$WallHex = '#ffffff', [double]$Strength = 1.0, [double]$Gamma = 1.5, [double]$Saturation = 1.0, [double]$Luminance = 1.0)
    $h = $WallHex.TrimStart('#')
    $wr = [Convert]::ToInt32($h.Substring(0, 2), 16) / 255.0
    $wg = [Convert]::ToInt32($h.Substring(2, 2), 16) / 255.0
    $wb = [Convert]::ToInt32($h.Substring(4, 2), 16) / 255.0
    # Inverse reflectance, floored so a saturated wall cannot demand x10 red.
    $ir = 1 / [Math]::Max($wr, 0.2); $ig = 1 / [Math]::Max($wg, 0.2); $ib = 1 / [Math]::Max($wb, 0.2)
    $m = [Math]::Max($ir, [Math]::Max($ig, $ib))
    $kr = 1 + $Strength * ($ir / $m - 1); $kg = 1 + $Strength * ($ig / $m - 1); $kb = 1 + $Strength * ($ib / $m - 1)
    $c = { param($r, $g, $b) @([int][Math]::Round(255 * $r * $kr), [int][Math]::Round(255 * $g * $kg), [int][Math]::Round(255 * $b * $kb)) }
    @{
        imageToLedMappingType = 'advanced'
        sparse_processing     = $true
        channelAdjustment     = @(@{
            id = 'default'; leds = '*'; classic_config = $false
            red = (& $c 1 0 0); green = (& $c 0 1 0); blue = (& $c 0 0 1)
            cyan = (& $c 0 1 1); magenta = (& $c 1 0 1); yellow = (& $c 1 1 0); white = (& $c 1 1 1); black = @(0, 0, 0)
            gamma = $Gamma; saturationGain = $Saturation; luminanceGain = $Luminance
            backlightThreshold = 0; backlightColored = $false; powerLimit = 1; scaleOutput = 1
            temperatureSetting = 'disabled'; temperatureRed = 1; temperatureGreen = 1; temperatureBlue = 1
        })
    }
}

function New-BorderLayout {
    <#
    .SYNOPSIS Perimeter layout in the strip's PHYSICAL order.
    .PARAMETER Order  Segments in wire order, e.g. 'right','top','left'.
    .PARAMETER Counts Hashtable side -> LED count.
    .PARAMETER Depth  How far into the screen each LED samples (0.08 = 8 %).
    .NOTES Directions follow how a strip physically runs when stuck on a
      monitor back viewed from the front: right = bottom->top, top =
      right->left, left = top->bottom, bottom = left->right.
    #>
    param(
        [string[]]$Order = @('right', 'top', 'left'),
        [hashtable]$Counts = @{ right = 17; top = 31; left = 17 },
        [double]$Depth = 0.08
    )
    $leds = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($side in $Order) {
        $n = [int]$Counts[$side]
        for ($i = 0; $i -lt $n; $i++) {
            $a = $i / $n; $b = ($i + 1) / $n
            $led = switch ($side) {
                'right'  { @{ hmin = 1 - $Depth; hmax = 1; vmin = 1 - $b; vmax = 1 - $a } }   # bottom -> top
                'top'    { @{ hmin = 1 - $b; hmax = 1 - $a; vmin = 0; vmax = $Depth } }       # right -> left
                'left'   { @{ hmin = 0; hmax = $Depth; vmin = $a; vmax = $b } }               # top -> bottom
                'bottom' { @{ hmin = $a; hmax = $b; vmin = 1 - $Depth; vmax = 1 } }           # left -> right
            }
            $led.group = 0
            $leds.Add($led)
        }
    }
    return $leds.ToArray()
}

function New-RegionLayout {
    <#
    .SYNOPSIS Single "LED" covering a screen region -- for whole-strip or
      single-colour lights (BLE strip, smart bulbs, PC glow).
    .PARAMETER Region  full | left | right | top | bottom | center
    #>
    param([string]$Region = 'full')
    $r = switch ($Region) {
        'left'   { @{ hmin = 0.0; hmax = 0.35; vmin = 0.1; vmax = 0.9 } }
        'right'  { @{ hmin = 0.65; hmax = 1.0; vmin = 0.1; vmax = 0.9 } }
        'top'    { @{ hmin = 0.0; hmax = 1.0; vmin = 0.0; vmax = 0.25 } }
        'bottom' { @{ hmin = 0.0; hmax = 1.0; vmin = 0.75; vmax = 1.0 } }
        'center' { @{ hmin = 0.25; hmax = 0.75; vmin = 0.25; vmax = 0.75 } }
        # Picture-safe thirds: a 21:9 film on the 21:9 Odyssey still gets
        # pillar/letter boxes from the player UI, and the outer 35 % was
        # reading black -> the case strips only pulsed with brightness.
        'left3'  { @{ hmin = 0.12; hmax = 0.42; vmin = 0.2; vmax = 0.8 } }
        'right3' { @{ hmin = 0.58; hmax = 0.88; vmin = 0.2; vmax = 0.8 } }
        'mid'    { @{ hmin = 0.3; hmax = 0.7; vmin = 0.15; vmax = 0.85 } }
        # Upper band of the picture, letterbox-safe: what a monitor light bar
        # sitting on the top bezel should echo.
        'top3'   { @{ hmin = 0.12; hmax = 0.88; vmin = 0.12; vmax = 0.4 } }
        default  { @{ hmin = 0.0; hmax = 1.0; vmin = 0.0; vmax = 1.0 } }
    }
    $r.group = 0
    return @($r)
}
