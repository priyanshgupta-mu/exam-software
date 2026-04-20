# ExamApp - AI Proctoring Security Documentation

## Overview

ExamApp implements 7 layers of AI-powered proctoring with 60+ blocked applications, real-time face/body/object detection, and complete system lockdown. **3 violations = automatic exam submission.**

---

## Layer 1: AI Face Detection (BlazeFace - runs every 500ms)

| Detection | Threshold | Action |
|---|---|---|
| No face visible | 1 second absent | Violation |
| Multiple faces in frame | 2 consecutive detections | Violation |
| Identity mismatch (person swap) | Biometric drift > 0.55, checked every 30s | Violation |
| Looking away (left/right) | Head turned > 0.20 offset for 5 seconds | Warning |
| Head tilted down (reading notes) | Vertical tilt > 0.28 for 5 seconds | Warning |
| Head turned sideways (profile) | Ear ratio < 0.22 for 3 seconds | Warning |
| Face too far from camera | Face area < 1.8% of frame for 2.5 seconds | Warning |
| Face out of frame | Within 8% of frame edge for 3 seconds | Warning |
| Leaving camera view | Position drift > 0.50 for 3 seconds | Warning |
| Talking / lip movement | Mouth pixel diff > 40 for 5 seconds | Warning |

> 3 consecutive warnings of the same type = 1 violation

---

## Layer 2: AI Person & Object Detection (COCO-SSD - runs every 500ms)

### Person Detection
| Detection | Confidence | Action |
|---|---|---|
| 2+ person bodies in frame | > 25% | Violation |
| Person in background (far from student) | > 25%, distance > 25% of frame | Warning |

### Forbidden Object Detection
| Object | Confidence | Sustained | Action |
|---|---|---|---|
| Mobile phone (cell phone) | > 45% | 1.5 seconds | Violation |
| Book / notes | > 45% | 1.5 seconds | Violation |
| Laptop / second device | > 45% | 1.5 seconds | Violation |

---

## Layer 3: Biometric Identity Verification

- Captures facial landmark signature at exam start (after 3 seconds of stable face)
- Measures: eye-to-nose ratio, eye-to-mouth ratio, nose-to-mouth ratio
- Compares against baseline every 30 seconds
- If facial geometry drift > 0.55 on 2 consecutive checks: **Identity Mismatch Violation**
- Prevents: person swap mid-exam, having someone else take the exam

---

## Layer 4: Audio Monitoring

| Detection | Threshold | Action |
|---|---|---|
| Loud noise / conversation | RMS > 4x adaptive baseline AND RMS > 18 | Warning |

- Adaptive baseline adjusts gradually to room ambient noise
- Normal typing, mouse clicks, and ambient sounds are ignored
- Only sustained loud speech-level audio triggers

---

## Layer 5: Violation Evidence Snapshots

- Every violation automatically saves a **PNG screenshot** from the webcam
- Saved to: `%APPDATA%/examapp/violations/` (Windows) or `~/Library/Application Support/examapp/violations/` (macOS)
- Filename format: `violation_2026-04-06T14-30-00_Phone_Detected.png`
- Available for post-exam review by invigilators

---

## Layer 6: Blocked Applications (60+ processes)

### VPN Clients (blocked to prevent IP masking)
| Application | Process Names |
|---|---|
| NordVPN | nordvpn, nordvpnservice, nordvpnd |
| ExpressVPN | expressvpn, expressvpnservice, expressvpnd |
| ProtonVPN | protonvpn, protonvpnservice, protonvpnd |
| Windscribe | windscribe, windscribeservice |
| Mullvad | mullvad-vpn, mullvad-daemon, mullvadvpn |
| Surfshark | surfshark, surfsharksvc |
| Hotspot Shield | hotspotshield, hotspotshieldsvc |
| TunnelBear | tunnelbear, tunnelbearhelper |
| CyberGhost | cyberghost, cyberghostsvc |
| OpenVPN | openvpn, openvpnserv |
| WireGuard | wireguard, wireguardtunnel, wireguard-go |
| Others | ipvanish, purevpn, pia_manager, privateinternetaccess, hideguard, ultrasurf, psiphon |

### AI / GPT Answer Assistants (blocked to prevent AI-generated answers)
| Application | Process Names |
|---|---|
| ChatGPT | chatgpt |
| Claude | claude |
| Google Gemini | gemini |
| GitHub Copilot | copilot, windowscopilot |
| Cursor IDE | cursor |
| Windsurf IDE | windsurf |
| Perplexity | perplexity |
| Poe | poe |
| Monica | monica |
| Merlin | merlin |
| Tabnine | tabnine |
| Codeium | codeium |
| Sourcegraph Cody | sourcegraph |
| Grammarly | grammarly |
| QuillBot | quillbot |
| Wordtune | wordtune |
| SuperWhisper | superwhisper, whisperdesktop |
| Raycast (macOS) | raycast |
| Alfred (macOS) | alfred |

### IDEs with AI Features
| Application | Process Names |
|---|---|
| VS Code | code, code - insiders |
| Zed Editor | zed |

### Screen Capture / Broadcast / Virtual Camera
| Application | Process Names |
|---|---|
| OBS Studio | obs64, obs32, obs |
| Streamlabs | streamlabs, streamlabsobs |
| XSplit | xsplit, xsplit vcam |
| Bandicam | bandicam |
| Camtasia | camtasia |
| Fraps | fraps |
| NVIDIA ShadowPlay | shadowplay, nvcplui |
| Loom | loom |
| ScreenFlow | screenflow |
| Snagit | snagit |
| Snap Camera | snap camera |
| NVIDIA Broadcast | nvidia broadcast |
| mmhmm | mmhmm |
| Ecamm | ecamm |
| CleanShot | cleanshot |
| TextSniper (OCR) | textsniper |
| macOS Screenshot | screencapture |

### Remote Desktop / Access
| Application | Process Names |
|---|---|
| TeamViewer | teamviewer, teamviewer_service, teamviewerd |
| AnyDesk | anydesk, anydeskd |
| RustDesk | rustdesk |
| UltraVNC | ultravnc, tvnserver, vncserver |
| Windows RDP | rdpclip, mstsc |
| Parsec | parsec |
| Ammyy Admin | ammyy_admin |
| LogMeIn | logmein |
| Splashtop | splashtop |
| macOS Screen Sharing | screensharing, com.apple.screensharing |

### Communication Apps (blocked to prevent unauthorized help)
| Application | Process Names |
|---|---|
| Discord | discord |
| Slack | slack |
| Telegram | telegram |
| WhatsApp | whatsapp |
| Signal | signal |
| Zoom | zoom |
| Microsoft Teams | teams, msteams |
| Webex | webex |
| Skype | skype |

### Clipboard Managers
| Application | Process Names |
|---|---|
| Ditto (Windows) | ditto |
| Clipy (macOS) | clipy |
| Pastebot | pastebot |
| Pasta | pasta |

> Process scanning runs every 4 seconds with an immediate scan on exam start.

---

## Layer 7: System Lockdown

### Window Lockdown
- Full kiosk mode (no title bar, no close/minimize/maximize buttons)
- Always on top (screen-saver level — sits above everything)
- Visible on all workspaces and virtual desktops
- Cannot be resized, moved, minimized, or closed
- Hidden from taskbar
- macOS: dock icon hidden, traffic light buttons hidden

### Keyboard Shortcuts Blocked

**All Platforms:**
- F1 through F12

**Windows:**
- Windows key (all combos: Win+D, Win+E, Win+L, Win+R, Win+Tab, Win+M, Win+P, Win+A, Win+S, Win+I, Win+X)
- Alt+Tab, Alt+F4, Alt+Space, Alt+Escape
- Ctrl+Escape (Start menu)
- Ctrl+Alt+Tab (Task switcher)
- Ctrl+Shift+Escape (Task Manager)

**macOS:**
- Cmd+Tab, Cmd+Q, Cmd+W, Cmd+H, Cmd+M
- Cmd+Space (Spotlight)
- Cmd+Shift+3/4/5/6 (Screenshots)
- Cmd+Option+Escape (Force Quit)
- Ctrl+Up/Down/Left/Right (Mission Control, Spaces)
- Cmd+F3 (Show Desktop)

### In-App Keyboard Blocking
- All F-keys → violation
- All Alt combinations → violation
- Windows/Cmd key → violation
- Tab key → silently blocked
- All Ctrl combos except Ctrl+A/Z/Y in textarea → violation
- PrintScreen key → violation
- Escape → silently re-enters fullscreen

### Input Blocking
- Right-click → violation
- Paste (Ctrl+V) → violation
- Copy (except in textarea) → blocked
- Drag and drop → blocked
- Text injection (50+ chars in < 400ms) → violation

### Browser Security
- Tab/window switch → violation (visibilitychange API)
- Window blur → auto-refocuses
- Fullscreen exit → auto re-enters (checked every 300ms)
- Page navigation → blocked (beforeunload)
- DevTools → violation (size-based detection every 3 seconds)
- Screen sharing (getDisplayMedia) → patched and blocked → violation
- New windows → blocked (setWindowOpenHandler)
- Navigation to external URLs → blocked

### Network Restrictions
- ALL external HTTP/HTTPS/WebSocket requests blocked
- Only allowed: localhost, 127.0.0.1
- Exception: TensorFlow.js model CDN hosts (storage.googleapis.com, tfhub.dev, kaggle.com, cdn.jsdelivr.net)

### Virtual Machine Detection
Exam refuses to start if running inside:
- VMware
- VirtualBox / VBox
- QEMU
- Xen
- Parallels
- Hyper-V
- Bochs
- KVM
- Oracle VM
- Innotek
- Any detected "virtual machine" string

### Other Protections
- Screen sleep prevention (powerSaveBlocker)
- Hardware media key blocking
- Single instance enforcement (prevents running multiple copies)
- Automatic exam submission after 3 violations
- 1-hour exam timer with auto-submit

---

## Summary

| Category | Count |
|---|---|
| Blocked applications | 60+ |
| Keyboard shortcuts blocked | 39+ |
| Direct violation types | 19 |
| Escalatable warning types | 9 |
| AI models running | 2 (BlazeFace + COCO-SSD) |
| Detection frequency | Every 500ms |
| Forbidden objects detected | 3 (phone, book, laptop) |
| VM types detected | 11+ |
| Process scan frequency | Every 4 seconds |
| Fullscreen enforcement | Every 300ms |
| Max violations before auto-submit | 3 |
