#!/usr/bin/env python3
from pathlib import Path
import sys
import zipfile

if len(sys.argv) != 2:
    raise SystemExit("usage: debug_harness_make_vsix.py <output.vsix>")

root = Path(__file__).resolve().parent
manifest = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0">
  <Metadata>
    <DisplayName>Protos Debug Harness</DisplayName>
    <Description>CI-only debugger acceptance harness.</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.104.0" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.104.0,*)" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest"
           Path="extension/package.json"
           Addressable="true" />
  </Assets>
</PackageManifest>
"""
content_types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="text/javascript" />
</Types>
"""
with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("extension.vsixmanifest", manifest)
    archive.write(root / "package.json", "extension/package.json")
    archive.write(root / "extension.js", "extension/extension.js")
