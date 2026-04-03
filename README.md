# Meshtastic Relay Finder

A specialized web-based serial terminal designed to identify which nodes in a Meshtastic mesh network are rebroadcasting your packets.

## Features

- **Real-time Packet Tracking**: Automatically detects and tracks packets sent from your node.
- **Relay Identification**: Identifies the specific relay byte of nodes that rebroadcast your messages.
- **Signal Statistics**: Displays SNR (Signal-to-Noise Ratio) and RSSI (Received Signal Strength Indicator) for each relay event.
- **Local-First Architecture**: All data is processed and stored locally in your browser. No sign-in required.
- **Noise Filtering**: Option to filter out background telemetry and position updates to focus on message relays.
- **Web Serial Integration**: Connects directly to your Meshtastic node via USB using the Web Serial API.

## How to Use

1. **Connect**: Click the "Connect" button and select your Meshtastic node's serial port.
2. **Set Node ID**: Enter your Node ID (e.g., `!9e7620e0`) in the header to start tracking your own packets.
3. **Send a Message**: Send a text message from your phone or another device connected to your node.
4. **Watch Relays**: As other nodes rebroadcast your message, they will appear in the "Relays" panel with their signal statistics.

## Technical Details

- Built with **React** and **Vite**.
- Styled with **Tailwind CSS**.
- Icons by **Lucide React**.
- Animations by **Motion**.
- Deployment ready for **Firebase Hosting** with **GitHub Actions**.

## Deployment

This project is configured for automatic deployment to Firebase Hosting via GitHub Actions.

1. Push the code to a GitHub repository.
2. Set up a Firebase project and enable Hosting.
3. Add the `FIREBASE_SERVICE_ACCOUNT_MESHTASTIC_RELAY_FINDER` secret to your GitHub repository settings.

---
Powered by [le-francais.ru](https://le-francais.ru)
