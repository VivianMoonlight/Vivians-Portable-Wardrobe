$files = Get-ChildItem -Path "src/components" -Recurse -Filter "*.vue"
$rows = @()
foreach ($f in $files) {
  $c = Get-Content -Raw -LiteralPath $f.FullName
  $imports = [regex]::Matches($c, 'import\s+.+?from\s+["''](.+?)["'']') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $stores = $imports | Where-Object { $_ -match 'store|stores' }
  $composables = $imports | Where-Object { $_ -match 'composable|composables' }
  $services = $imports | Where-Object { $_ -match 'service|services' }
  $children = $imports | Where-Object { $_ -match '\.vue$' }
  $emits = [regex]::Matches($c, 'defineEmits\((.*?)\)', 'Singleline') | ForEach-Object { $_.Groups[1].Value.Trim() }
  $hasDrag = $c -match 'draggable|@drag|@drop|dragstart|dragover'
  $hasFilter = $c -match 'filter|search'
  $hasEdit = $c -match 'rename|edit|update:modelValue|@input|v-model'
  $hasDialog = $c -match 'DialogService|dialog|modal|confirm\(|alert\(|prompt\('
  $hasTeleport = $c -match '<teleport'
  $styleTags = [regex]::Matches($c, '<style[^>]*>') | ForEach-Object { $_.Value }
  $scoped = ($styleTags | Where-Object { $_ -match 'scoped' }).Count -gt 0
  $tokenCount = ([regex]::Matches($c, 'var\(--[a-zA-Z0-9-]+') | Measure-Object).Count
  $rel = [IO.Path]::GetRelativePath((Get-Location).Path, $f.FullName).Replace('\\','/')
  $inter = @()
  if($hasDrag){$inter += 'dragdrop'}
  if($hasFilter){$inter += 'filter/search'}
  if($hasEdit){$inter += 'edit/input'}
  if($hasDialog){$inter += 'dialog/modal'}
  if($hasTeleport){$inter += 'teleport'}
  $rows += [PSCustomObject]@{
    File=$rel
    Stores=($stores -join ', ')
    Composables=($composables -join ', ')
    Services=($services -join ', ')
    Children=($children -join ', ')
    Emits=($emits -join ' | ')
    Interactions=($inter -join ', ')
    Scoped=$scoped
    TokenRefs=$tokenCount
  }
}
$rows | Sort-Object File | ConvertTo-Json -Depth 4
