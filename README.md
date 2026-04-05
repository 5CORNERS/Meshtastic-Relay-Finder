# Meshtastic Relay Finder

**Live App:** [https://meshtastic-relay-finder.web.app](https://meshtastic-relay-finder.web.app)

Meshtastic Relay Finder is a web-based tool designed to solve two specific challenges that are difficult to address using the standard Meshtastic mobile application.

---

## The Challenges

### Problem #1: Who Relayed My Packet?

When you send a packet into the network—whether it's a Direct Message (DM) or a Broadcast—it is relayed by other nodes. However, not every node that hears your message will rebroadcast it. To prevent the network from being flooded, Meshtastic uses a mechanism called **Managed Flooding**.

To maximize range, we want the *most distant* node that can hear us to be the one that relays our message further into the network. But how do nodes "agree" on who is the furthest away without knowing each other's locations?

**How it works:**
Meshtastic uses your signal quality (specifically **SNR** — Signal-to-Noise Ratio) as a proxy for distance. The worse a node hears you, the further away it is assumed to be, and the higher priority it gets for relaying. This priority is implemented through a **rebroadcast delay**:
- **Distant nodes** (low SNR) have a short delay and rebroadcast almost immediately.
- **Nearby nodes** (high SNR) wait longer. If they hear someone else relay the packet during their wait time, they "wash their hands" of the task and stay quiet.

**Why this matters:**
This mechanism works perfectly in an ideal world. But in reality, a low SNR doesn't always mean a node is far away—it could just mean it has a poor antenna or a bad location (e.g., a node on a first-floor windowsill in a nearby courtyard).

The worst-case scenario is a nearby node in a "radio shadow" that wins the rebroadcast competition but isn't heard by anyone else except you. Your node hears the relay and marks your message as "sent" (the cloud icon with a checkmark), but in reality, your message has hit a **dead end**. You might only realize this by the total lack of response or its absence in the network "mirror."

**Meshtastic Relay Finder** helps you identify exactly which nodes are relaying your packets so you can spot these "dead ends" and understand your true network reach.

---

### Problem #2: Real-time Antenna Alignment

Even a small adjustment to an antenna's position can significantly improve reception, especially with directional antennas. The standard way to tune this is iterative: move the antenna, check the signal, and repeat.

**The issue with the native app:**
Signal information typically updates in the native app at long intervals. By the time you see a change, environmental conditions might have shifted more than your antenna adjustment, making the process nearly impossible.

**The solution:**
Any Meshtastic node connected via USB outputs a detailed serial log of every internal event. It "spits out" information about every packet flying by, including the SNR and RSSI of every node it hears. Since these events happen frequently (every few seconds in a busy network), we can "fish" this data out of the log and present it in real-time.

**Meshtastic Relay Finder** allows you to watch signal levels of surrounding nodes live, making it easy to find the optimal antenna position by observing immediate feedback.

---

## How it Works

![Relay Finder Interface](assets/relay-finder-screen.png)

Meshtastic Relay Finder is a web application that uses the **Web Serial API** to read the event logs directly from your node via USB.

### Key Features:
- **Dual Connectivity:** Your node can remain connected to your phone via Bluetooth or Wi-Fi while being plugged into your computer via USB. You can initiate traffic (send messages, request Node Info, run Trace Routes) on your phone and watch the relay analysis live in the browser.
- **Smart Filtering:** The app analyzes the incoming stream and filters out noise. It groups log lines by Packet ID, linking all related events together.
- **Relay Identification:** When a relay is detected, the app displays the last byte of that node's ID in the sidebar.
- **Grouped Views:**
  - **By Nodes:** See which nodes are acting as your most frequent relays, along with their SNR and RSSI.
  - **By Packets:** See the "life story" of each packet, including which nodes picked it up and relayed it.
    ![Nodes grouped by packets](assets/nodes-grouped-by-packets.png)
- **"Collect All" Mode:** Enable this to track every single packet in range, not just your own. This is perfect for real-time antenna tuning, as it provides a constant stream of signal data from the entire neighborhood.

---

### Real-world Example: Antenna Tuning
![Real-time signal level tracking](assets/tracking-signal-level-on-the-fly.png)
Using the "Collect All" mode, I tested raising my panel antenna just 30 cm higher on a windowsill. The results were immediate: I could see the SNR of distant nodes improve or degrade instantly as I moved the antenna closer to the window frame or metal shutters. I waited to ensure it wasn't just a fluctuation, then moved it back—the values returned to their previous state. It works!

---

*Powered by le-francais.ru*
