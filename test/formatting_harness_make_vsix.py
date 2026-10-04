#!/usr/bin/env python3
from pathlib import Path
import sys
import zipfile


if len(sys.argv) != 2:
    raise RuntimeError(
        "usage: formatting_harness_make_vsix.py <output.vsix>"
    )

root = Path(__file__).resolve().parent
output = Path(sys.argv[1])

manifest = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0">
  <Metadata>
    <DisplayName>Protos Formatting Harness</DisplayName>
    <Description>CI-only LM011-D2 installed-VSIX formatting harness.</Description>
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

with zipfile.ZipFile(
    output,
    "w",
    compression=zipfile.ZIP_DEFLATED,
) as archive:
    archive.writestr(
        "[Content_Types].xml",
        content_types,
    )
    archive.writestr(
        "extension.vsixmanifest",
        manifest,
    )
    archive.write(
        root / "formatting_harness_package.json",
        "extension/package.json",
    )
    archive.write(
        root / "formatting_harness_extension.js",
        "extension/extension.js",
    )

print(output)
