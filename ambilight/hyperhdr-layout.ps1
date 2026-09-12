# Dot-source. LED geometry generators for HyperHDR `leds` arrays.
# Each LED is a rectangle in normalized screen space: hmin/hmax/vmin/vmax.

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
        default  { @{ hmin = 0.0; hmax = 1.0; vmin = 0.0; vmax = 1.0 } }
    }
    $r.group = 0
    return @($r)
}
