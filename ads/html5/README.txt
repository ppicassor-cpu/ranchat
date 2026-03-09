RanChat HTML5 ad templates

Folders:
- 320x480
- 480x320

Each folder contains:
- index.html
- style.css
- script.js

Packaging examples (PowerShell):
- Compress-Archive -Path .\ads\html5\320x480\* -DestinationPath .\ads\html5\ranchat_320x480.zip -Force
- Compress-Archive -Path .\ads\html5\480x320\* -DestinationPath .\ads\html5\ranchat_480x320.zip -Force

Google Ads upload checks:
- ZIP format
- <= 512 files in zip
- <= 5 MB zip size
- ad.size must match creative dimensions
