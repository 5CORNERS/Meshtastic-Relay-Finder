/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Usb, Search, CheckCircle, AlertCircle, Terminal, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface LogEntry {
  id: number;
  timestamp: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'serial';
}

export default function App() {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [reader, setReader] = useState<ReadableStreamDefaultReader<string> | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [myNodeId, setMyNodeId] = useState<string>("!9e7620e0");
  const [filterTelemetry, setFilterTelemetry] = useState(false);
  const [collectAllStats, setCollectAllStats] = useState(false);
  const [trackedPacketIds, setTrackedPacketIds] = useState<string[]>([]);
  const [allSeenPacketIds, setAllSeenPacketIds] = useState<string[]>([]);
  const [relayNodes, setRelayNodes] = useState<{
    byte: string, 
    entries: {id: string, port: string, snr?: string, rssi?: string}[]
  }[]>([]);
  const [relayViewMode, setRelayViewMode] = useState<'by-node' | 'by-packet'>('by-node');
  const [packetMessages, setPacketMessages] = useState<Record<string, string>>({});
  const [requestMap, setRequestMap] = useState<Record<string, string>>({}); // responseId -> requestId
  const [relayAutoScroll, setRelayAutoScroll] = useState(true);
  const [isReceiving, setIsReceiving] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  
  const myNodeIdRef = useRef<string>("!9e7620e0");
  const tracerouteStateRef = useRef<{active: boolean, requestId: string | null, lines: string[]}>({active: false, requestId: null, lines: []});
  const lastTracerouteRequestIdRef = useRef<string | null>(null);
  const packetSignalRef = useRef<Record<string, {snr: string, rssi: string}>>({});
  const seenSignalLogsRef = useRef<Set<string>>(new Set());
  const filterTelemetryRef = useRef<boolean>(false);
  const collectAllStatsRef = useRef<boolean>(false);
  const trackedPacketIdsRef = useRef<string[]>([]);
  const packetMapRef = useRef<Record<string, string>>({}); // packetId -> relay byte
  const portMapRef = useRef<Record<string, string>>({}); // packetId -> portName
  const lastDataTime = useRef<number>(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const relayListRef = useRef<HTMLDivElement>(null);
  const logCounter = useRef(0);

  const PORTNUM_MAP: Record<string, string> = {
    '1': 'TEXT',
    '2': 'REMOTE',
    '3': 'POS',
    '4': 'NODEINFO',
    '5': 'ROUTING',
    '6': 'ADMIN',
    '67': 'TELE',
    '70': 'TRACE',
    '71': 'WAYPOINT',
    '72': 'AUDIO',
  };

  // Persistence for Node ID
  useEffect(() => {
    const saved = localStorage.getItem('meshtastic_node_id');
    if (saved) {
      setMyNodeId(saved);
      myNodeIdRef.current = saved;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('meshtastic_node_id', myNodeId);
    myNodeIdRef.current = myNodeId;
  }, [myNodeId]);

  useEffect(() => {
    filterTelemetryRef.current = filterTelemetry;
  }, [filterTelemetry]);

  useEffect(() => {
    collectAllStatsRef.current = collectAllStats;
  }, [collectAllStats]);

  // --- Helpers ---
  const getSnrColor = (snr: string | undefined) => {
    if (!snr) return 'text-gray-400';
    if (snr.includes('?')) return 'text-gray-500';
    const val = parseFloat(snr);
    if (val >= -7) return 'text-green-400';
    if (val >= -15) return 'text-amber-400';
    return 'text-red-400';
  };

  const getRssiColor = (rssi: string | undefined) => {
    if (!rssi) return 'text-gray-400';
    const val = parseFloat(rssi);
    if (val >= -115) return 'text-green-400';
    if (val >= -126) return 'text-amber-400';
    return 'text-red-400';
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setIsReceiving(now - lastDataTime.current < 2000);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'info') => {
    // Try to decode hex sequences like \xXX\xYY which are common for UTF-8/Cyrillic
    const decodedText = text.replace(/(\\x[0-9a-fA-F]{2})+/g, (match) => {
      try {
        const hexes = match.split('\\x').slice(1);
        const bytes = new Uint8Array(hexes.map(h => parseInt(h, 16)));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        // If it's just a bunch of hashes or non-printable, return original
        if (decoded.includes('')) return match;
        return decoded;
      } catch (e) {
        return match;
      }
    });

    const newEntry: LogEntry = {
      id: logCounter.current++,
      timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      text: decodedText,
      type,
    };
    setLogs(prev => [...prev.slice(-200), newEntry]);
  }, []);

  const scrollToBottom = () => {
    if (autoScroll && logsContainerRef.current) {
      isProgrammaticScrollRef.current = true;
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      // Reset after a short delay to allow scroll event to fire
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 50);
    }
  };

  const handleLogScroll = () => {
    if (logsContainerRef.current && !isProgrammaticScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      if (autoScroll !== isAtBottom) {
        setAutoScroll(isAtBottom);
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  useEffect(() => {
    if (relayAutoScroll && relayListRef.current) {
      relayListRef.current.scrollTop = relayListRef.current.scrollHeight;
    }
  }, [relayNodes, trackedPacketIds, relayAutoScroll]);

  useEffect(() => {
    if (relayListRef.current) {
      relayListRef.current.scrollTop = relayListRef.current.scrollHeight;
      setRelayAutoScroll(true);
    }
  }, [relayViewMode]);

  const handleRelayScroll = () => {
    if (relayListRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = relayListRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
      setRelayAutoScroll(isAtBottom);
    }
  };

  // --- Serial Logic ---
  const connect = async () => {
    try {
      if (!('serial' in navigator)) {
        addLog("Web Serial API is not supported.", 'error');
        return;
      }
      const selectedPort = await navigator.serial.requestPort();
      await selectedPort.open({ baudRate: 115200 });
      setPort(selectedPort);
      setIsConnected(true);
      addLog("Connected to Meshtastic node.", 'success');

      const textDecoder = new TextDecoderStream();
      selectedPort.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      setReader(reader);

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) processLine(line);
        }
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setIsConnected(false);
    }
  };

  const disconnect = async () => {
    if (reader) await reader.cancel();
    if (port) await port.close();
    setPort(null);
    setReader(null);
    setIsConnected(false);
    addLog("Disconnected.", 'warning');
  };

  const processLine = (line: string) => {
    lastDataTime.current = Date.now();
    const cleanLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    
    const idMatch = cleanLine.match(/id\s*=\s*(?:0x|!|)([a-f0-9]{8,})/i);
    const frMatch = cleanLine.match(/(?:fr|from)\s*=\s*(?:0x|!|)([a-f0-9]+)/i);
    const toMatch = cleanLine.match(/to\s*=\s*(?:0x|!|)([a-f0-9]{8,})/i);
    const relayMatch = cleanLine.match(/relay\s*=\s*0x([a-f0-9]+)/i);
    const reqIdMatch = cleanLine.match(/requestId=(?:0x|!|)([a-f0-9]{8,})/i);
    const portMatch = cleanLine.match(/Portnum=(\d+)/i);
    const hopLimitMatch = cleanLine.match(/HopLim=(\d+)/i);

    const currentPacketId = idMatch ? idMatch[1].toLowerCase().replace(/^0x/, '') : null;
    const currentSourceId = frMatch ? frMatch[1].toLowerCase().replace(/^0x/, '') : null;
    const currentDestId = toMatch ? toMatch[1].toLowerCase().replace(/^0x/, '') : null;
    const portNum = portMatch ? portMatch[1] : null;
    let portName = portNum ? (PORTNUM_MAP[portNum] || `PORT:${portNum}`) : 'UNKNOWN';
    const hopLimit = hopLimitMatch ? parseInt(hopLimitMatch[1]) : null;

    const snrMatch = cleanLine.match(/rxSNR=(-?\d+\.?\d*)/i);
    const rssiMatch = cleanLine.match(/rxRSSI=(-?\d+)/i);
    const msgMatch = cleanLine.match(/msg\s*=\s*(.*?)(?=\s\w+=|$)/i);
    
    let currentSnr = snrMatch ? snrMatch[1] : null;
    if (currentSnr === "-1") currentSnr = "-1?";
    const currentRssi = rssiMatch ? rssiMatch[1] : null;
    const currentRequestId = reqIdMatch ? reqIdMatch[1].toLowerCase() : null;

    if (currentPacketId && portName !== 'UNKNOWN') {
      portMapRef.current[currentPacketId] = portName;
    }

    if (currentPacketId && (currentSnr || currentRssi)) {
      packetSignalRef.current[currentPacketId] = {
        snr: currentSnr || packetSignalRef.current[currentPacketId]?.snr || '',
        rssi: currentRssi || packetSignalRef.current[currentPacketId]?.rssi || ''
      };
    }

    if (currentRequestId) {
      lastTracerouteRequestIdRef.current = currentRequestId;
      setRequestMap(prev => ({ ...prev, [currentPacketId!]: currentRequestId }));
    }

    if (currentPacketId) {
      if (msgMatch) {
        setPacketMessages(prev => ({ ...prev, [currentPacketId]: msgMatch[1].trim() }));
      } else if (portName === 'NODEINFO' && !packetMessages[currentPacketId]) {
        // Fallback for Node Info requests that don't have a explicit msg= string
        setPacketMessages(prev => ({ ...prev, [currentPacketId]: "Requesting Node Info" }));
      }
    }

    const summaryLogsToAdd: {text: string, type: LogEntry['type']}[] = [];

    // Traceroute block parsing
    if (cleanLine.includes("Route traced:")) {
      const reqId = lastTracerouteRequestIdRef.current;
      const hopPart = cleanLine.split("Route traced:")[1]?.trim();
      tracerouteStateRef.current = { 
        active: true, 
        requestId: reqId, 
        lines: (hopPart && (hopPart.includes("-->") || hopPart.includes("<--"))) ? [hopPart] : []
      };
      // Ensure we track the traceroute packet
      if (reqId && !trackedPacketIdsRef.current.includes(reqId)) {
        trackedPacketIdsRef.current = [...trackedPacketIdsRef.current, reqId];
        setTrackedPacketIds([...trackedPacketIdsRef.current]);
      }
    } else if (tracerouteStateRef.current.active) {
      const myIdNorm = myNodeIdRef.current.toLowerCase().replace(/^(!|0x)/, '');
      
      // Accumulate lines for the message content
      if (cleanLine.includes("-->") || cleanLine.includes("<--")) {
        tracerouteStateRef.current.lines.push(cleanLine.trim());
      }

      // Match: 0x9e7620e0 --> 0x4c47d65f (7.75dB)
      const outboundMatch = cleanLine.match(/(0x[a-f0-9]+)\s*-->\s*(0x[a-f0-9]+)\s*\((-?\d+\.?\d*)dB\)/i);
      // Match: (6.50dB) 0x9e7620e0 <-- 0x4c47d65f
      const inboundMatch = cleanLine.match(/\((-?\d+\.?\d*)dB\)\s*(0x[a-f0-9]+)\s*<--\s*(0x[a-f0-9]+)/i);

      if (outboundMatch || inboundMatch) {
        const from = (outboundMatch ? outboundMatch[1] : inboundMatch![3]).toLowerCase().replace(/^0x/, '');
        const to = (outboundMatch ? outboundMatch[2] : inboundMatch![2]).toLowerCase().replace(/^0x/, '');
        let snr = outboundMatch ? outboundMatch[3] : inboundMatch![1];
        if (snr === "-1") snr = "-1?";
        const isOutbound = !!outboundMatch;

        if (from === myIdNorm || to === myIdNorm) {
          const targetNode = from === myIdNorm ? to : from;
          const relayByte = targetNode.slice(-2).padStart(2, '0');
          
          const isTracked = tracerouteStateRef.current.requestId && trackedPacketIdsRef.current.includes(tracerouteStateRef.current.requestId);

          if (collectAllStatsRef.current || isTracked) {
            setRelayNodes(prev => {
              const existing = prev.find(n => n.byte === relayByte);
              const entry = { 
                id: tracerouteStateRef.current.requestId || 'TRACEROUTE', 
                port: 'TRACE', 
                snr, 
                rssi: undefined,
                isOutbound 
              };
              if (existing) {
                // Avoid duplicate identical entries
                const alreadyHas = existing.entries.some(e => e.id === entry.id && e.port === 'TRACE' && e.isOutbound === isOutbound);
                if (alreadyHas) return prev;
                return prev.map(n => n.byte === relayByte ? { ...n, entries: [...n.entries, entry] } : n);
              }
              return [...prev, { byte: relayByte, entries: [entry] }];
            });
          }
        }
      }

      // If block ends or we see a new log header
      if (!cleanLine.includes("-->") && !cleanLine.includes("<--") && !cleanLine.includes("Route traced:")) {
        if (tracerouteStateRef.current.requestId) {
          const myIdNorm = myNodeIdRef.current.toLowerCase().replace(/^(!|0x)/, '');
          const formattedLines = tracerouteStateRef.current.lines.map(l => {
            let processed = l;
            // Remove log metadata (e.g. "INFO  | 04:03:43 531 [Router] ")
            processed = processed.replace(/^.*?\[Router\]\s*/i, '');
            // Replace own ID
            processed = processed.replace(new RegExp(`0x${myIdNorm}`, 'gi'), 'YOU');
            // Replace FFFFFFFF
            processed = processed.replace(/0xffffffff/gi, 'UNKNOWN');
            // Replace arrows
            processed = processed.replace(/-->/g, '→').replace(/<--/g, '←');
            // Replace 0x with ! for other nodes (4 to 8 digits)
            processed = processed.replace(/0x([a-f0-9]{4,8})/gi, '!$1');
            return processed;
          });
          const fullText = formattedLines.join('\n');
          const reqId = tracerouteStateRef.current.requestId;
          setPacketMessages(prev => ({ ...prev, [reqId]: fullText }));
        }
        tracerouteStateRef.current.active = false;
      }
      
      // Only log traceroute lines if the request is tracked
      if (!currentPacketId) {
        const isTracked = tracerouteStateRef.current.requestId && trackedPacketIdsRef.current.includes(tracerouteStateRef.current.requestId);
        if (isTracked) {
          addLog(cleanLine, 'serial');
        }
        return;
      }
    }

    if (!currentPacketId) return;

    setAllSeenPacketIds(prev => {
      if (prev.includes(currentPacketId)) return prev;
      return [...prev, currentPacketId];
    });

    // Store message text if found
    if (msgMatch) {
      setPacketMessages(prev => ({ ...prev, [currentPacketId]: msgMatch[1].trim() }));
    }

    // Cache port name
    if (portName !== 'UNKNOWN') {
      portMapRef.current[currentPacketId] = portName;
    } else if (cleanLine.includes("Received text msg")) {
      portMapRef.current[currentPacketId] = 'TEXT';
    }
    const finalPortName = portMapRef.current[currentPacketId] || portName;

    const isLoraRx = cleanLine.includes("Lora RX");
    const isSomeoneRebroadcasting = cleanLine.toLowerCase().includes("someone rebroadcasting for us");

    // 1. Map relay bytes if present
    const isError = cleanLine.includes("ERROR");
    const isSendingEvent = cleanLine.includes("Sending packet") || 
                          cleanLine.includes("Lora TX") || 
                          cleanLine.includes("Started Tx") ||
                          cleanLine.includes("Completed sending") ||
                          cleanLine.includes("enqueue for send");

    const myIdNormalized = myNodeIdRef.current.toLowerCase().replace(/^(!|0x)/, '');
    const myRelayByte = myIdNormalized.slice(-2).padStart(2, '0');
    const rawRelayStr = relayMatch ? relayMatch[1].toLowerCase() : null;
    const relayByte = rawRelayStr ? rawRelayStr.slice(-2).padStart(2, '0') : null;

    // Filter out our own relay byte or truncated versions of it
    const isOurRelay = rawRelayStr && (
      relayByte === myRelayByte || 
      (rawRelayStr.length === 1 && myRelayByte.startsWith(rawRelayStr)) ||
      rawRelayStr === '0' || rawRelayStr === '00'
    );

    // Always store relay mapping if found, even if not tracked yet
    if (relayByte && !isError && !isSendingEvent && !isOurRelay) {
      packetMapRef.current[currentPacketId] = relayByte;
    }

    // Clear relay mapping if we see a Lora RX without relay (might be direct or different path)
    if (isLoraRx && !relayMatch) {
      delete packetMapRef.current[currentPacketId];
    }

    // 2. Detect Source (Our Node) and Start Tracking
    const isOurPacketTrigger = cleanLine.includes("Received text msg") || 
                              cleanLine.includes("Completed sending") ||
                              (cleanLine.includes("PACKET FROM PHONE") && 
                               (finalPortName === 'TEXT' || finalPortName === 'NODEINFO' || finalPortName === 'ROUTING' || finalPortName === 'TRACE'));
    const isExplicitlyOurs = currentSourceId && currentSourceId === myIdNormalized;
    const isSelfAck = currentSourceId && currentDestId && 
                     (currentSourceId === currentDestId) &&
                     (currentSourceId === myIdNormalized);
    
    const shouldTrack = isOurPacketTrigger && isExplicitlyOurs && !isSelfAck;

    if (shouldTrack) {
      if (!trackedPacketIdsRef.current.includes(currentPacketId)) {
        if (filterTelemetryRef.current && (finalPortName === 'TELE' || finalPortName === 'POS')) return;

        trackedPacketIdsRef.current = [...trackedPacketIdsRef.current, currentPacketId];
        setTrackedPacketIds([...trackedPacketIdsRef.current]);
        addLog(`[${finalPortName}] Started tracking packet ${currentPacketId} from your node.`, 'info');
      }
    }

    // 3. Process Signal Events (Rebroadcasts or Direct ACKs)
    const isTracked = trackedPacketIdsRef.current.includes(currentPacketId) || 
                     (currentRequestId && trackedPacketIdsRef.current.includes(currentRequestId));
    const isToMe = currentDestId && (currentDestId.replace(/^0x/, '') === myIdNormalized);
    const isDirectAck = cleanLine.includes("Received a ACK") || (isToMe && currentRequestId);
    const isConclusiveSignal = cleanLine.includes("Rx someone rebroadcasting") || 
                              cleanLine.includes("Received a ACK") || 
                              cleanLine.includes("direct response") ||
                              cleanLine.toLowerCase().includes("rebroadcasting for us");
    const isRebroadcast = (isSomeoneRebroadcasting || (isLoraRx && cleanLine.includes("relay="))) && 
                         !isSendingEvent;
    
    const isSignalEvent = (isRebroadcast || isDirectAck) && !isSendingEvent;

    if (isSignalEvent) {
      let relay = packetMapRef.current[currentPacketId] || relayByte;
      
      // If it's a direct packet to us, the relay is the sender
      if (isToMe && !relay && currentSourceId) {
        relay = currentSourceId.slice(-2).padStart(2, '0');
      }

      // Re-check isOurRelay for the final relay value
      const isOurRelayFinal = relay && (
        relay === myRelayByte || 
        (relay.length === 1 && myRelayByte.startsWith(relay)) ||
        relay === '0' || relay === '00'
      );

      if (relay && !isOurRelayFinal) {
        // Determine which packet ID to associate this signal with
        const targetPacketId = (isDirectAck && currentRequestId) ? currentRequestId : currentPacketId;
        const isTargetTracked = targetPacketId ? trackedPacketIdsRef.current.includes(targetPacketId) : false;

        // If not tracked yet, but we see a rebroadcast of something from us, track it!
        if (targetPacketId && !isTargetTracked && isExplicitlyOurs && !isSelfAck) {
          trackedPacketIdsRef.current = [...trackedPacketIdsRef.current, targetPacketId];
          setTrackedPacketIds([...trackedPacketIdsRef.current]);
          addLog(`[${finalPortName}] Auto-tracking relayed packet ${targetPacketId} from your node.`, 'info');
        }

      // Update relay nodes state
      if (targetPacketId && (collectAllStatsRef.current || trackedPacketIdsRef.current.includes(targetPacketId))) {
        const cachedSignal = packetSignalRef.current[currentPacketId || ''];
        const snr = currentSnr || cachedSignal?.snr;
        const rssi = currentRssi || cachedSignal?.rssi;
        
        // Use the port name from the map if we have it (e.g. from a previous packet with same ID)
        const displayPort = portMapRef.current[targetPacketId] || finalPortName;

        const newEntry = { 
          id: targetPacketId, 
          port: displayPort, 
          snr: snr || undefined, 
          rssi: rssi || undefined,
          isOutbound: false 
        };
          setRelayNodes(prev => {
            const existing = prev.find(n => n.byte === relay);
            if (existing) {
              const alreadyHasId = existing.entries.some(i => i.id === targetPacketId);
              if (alreadyHasId) {
                return prev.map(n => n.byte === relay ? {
                  ...n,
                  entries: n.entries.map(e => e.id === targetPacketId ? {
                    ...e,
                    snr: (snr && (!e.snr || snr.length >= e.snr.length)) ? snr : e.snr,
                    rssi: (rssi && (!e.rssi || rssi.length >= e.rssi.length)) ? rssi : e.rssi
                  } : e)
                } : n);
              }
              return prev.map(n => n.byte === relay ? { ...n, entries: [...n.entries, newEntry] } : n);
            }
            return [...prev, { byte: relay, entries: [newEntry] }];
          });

          // Log only once per packet/relay combination to avoid spam
          // ONLY log if it's a tracked packet (our packet) AND it's a conclusive line
          if (isConclusiveSignal && trackedPacketIdsRef.current.includes(targetPacketId)) {
            const logKey = `${targetPacketId}-${relay}-${isDirectAck ? 'direct' : 'relay'}`;
            if (!seenSignalLogsRef.current.has(logKey)) {
              seenSignalLogsRef.current.add(logKey);
              const displayPort = portMapRef.current[targetPacketId] || finalPortName;
              const displayPacketId = targetPacketId;
              const displayRelay = `0x${relay}`;
              
              if (isRebroadcast) {
                summaryLogsToAdd.push({ text: `[${displayPort}] Relay detected: ${displayRelay} for packet ${displayPacketId}`, type: 'success' });
              } else if (isDirectAck) {
                summaryLogsToAdd.push({ text: `[${displayPort}] Direct response: ${displayRelay} for packet ${displayPacketId}`, type: 'success' });
              }
            }
          }
        }
      }
    }

    // 4. Show log if tracked
    if (trackedPacketIdsRef.current.includes(currentPacketId) && !isSelfAck) {
      if (filterTelemetryRef.current && (finalPortName === 'TELE' || finalPortName === 'POS')) return;
      addLog(cleanLine, 'serial');
      // Add summary logs AFTER the raw log
      summaryLogsToAdd.forEach(l => addLog(l.text, l.type));
    }

  };

  const clearAll = () => {
    setLogs([]);
    setTrackedPacketIds([]);
    setAllSeenPacketIds([]);
    trackedPacketIdsRef.current = [];
    setRelayNodes([]);
    setPacketMessages({});
    packetMapRef.current = {};
    portMapRef.current = {};
  };

  const renderHighlightedLog = (text: string, id: number) => {
    const myIdNorm = myNodeId.toLowerCase().replace(/^(!|0x)/, '');
    const myLastByte = myIdNorm.slice(-2).padStart(2, '0');
    
    // Replace 0x with ! for Node IDs (4-8 hex digits) before highlighting
    // This ensures consistency across the app as requested.
    // We only replace if it's fr=, to=, from=, dest=, or in traceroute context.
    // We explicitly avoid id= and requestId= to keep packet IDs as they are.
    let processedText = text.replace(/((?:fr|to|from|dest|node|nodeid|user)\s*=\s*)0x([a-f0-9]{4,8})/gi, (match, prefix, hex) => {
      if (hex === '00000000') return match; // Keep zero ID as 0x
      return `${prefix}!${hex}`;
    });
    
    // Also handle standalone ones in traceroute (they usually look like 0x9e7620e0 →)
    processedText = processedText.replace(/0x([a-f0-9]{4,8})(?=\s*(?:→|←|--|>|<))/gi, (match, hex) => {
      if (hex === '00000000') return match;
      return `!${hex}`;
    });
    
    const patterns = [
      { regex: /msg\s*=\s*.*?(?=\s\w+=|$)/gi, style: 'bg-blue-500/20 text-blue-300 px-1 rounded' },
      { 
        regex: /relay\s*=\s*0x[a-f0-9]+/gi, 
        getStyle: (match: string) => {
          const hexPart = match.split('0x')[1]?.toLowerCase() || '';
          const byte = hexPart.slice(-2).padStart(2, '0');
          
          // Check if it's our relay byte, including truncated versions (e.g. 0xe for 0xe0)
          const isOurRelay = byte === myLastByte || 
                            (hexPart.length === 1 && myLastByte.startsWith(hexPart)) ||
                            hexPart === '0' || hexPart === '00';

          if (isOurRelay) {
            return 'bg-orange-500/30 text-orange-400 font-bold px-1 rounded border border-orange-500/20';
          }
          return 'bg-green-500/30 text-green-400 font-bold px-1 rounded border border-green-500/20 animate-pulse';
        }
      },
      { regex: /someone rebroadcasting for us/gi, style: 'bg-green-500/30 text-green-400 font-bold px-1 rounded' },
      { 
        regex: /\bTRACE\b|TRACEROUTE/gi, 
        getStyle: (match: string) => {
          return 'bg-blue-600/30 text-blue-400 font-bold px-1 rounded border border-blue-500/20 cursor-help';
        },
        hasTooltip: true
      }
    ];

    let parts: (string | React.ReactNode)[] = [processedText];

    patterns.forEach((pattern) => {
      const { regex } = pattern;
      const newParts: (string | React.ReactNode)[] = [];
      
      parts.forEach(part => {
        if (typeof part !== 'string') {
          newParts.push(part);
          return;
        }

        const matches = [...part.matchAll(regex)];
        let lastIndex = 0;

        matches.forEach((match, idx) => {
          if (match.index === undefined) return;
          
          newParts.push(part.substring(lastIndex, match.index));
          
          const style = pattern.getStyle ? pattern.getStyle(match[0]) : pattern.style;
          
          if (pattern.hasTooltip) {
            // Find packet ID or request ID in this log line to show content
            const idMatch = text.match(/id\s*=\s*(0x[a-f0-9]+|[a-f0-9]{8,})/i);
            const reqIdMatch = text.match(/requestId=(0x[a-f0-9]+|[a-f0-9]{8,})/i);
            const pktId = idMatch ? idMatch[1].toLowerCase().replace(/^0x/, '') : 
                         (reqIdMatch ? reqIdMatch[1].toLowerCase().replace(/^0x/, '') : null);
            
            const reqId = pktId ? (requestMap[pktId] || pktId) : null;
            const content = reqId ? packetMessages[reqId] : null;

            newParts.push(
              <span key={`${id}-${idx}`} className="relative group/trace inline-block">
                <span className={style}>{match[0]}</span>
                {content && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[#1c212c] border border-blue-500/50 rounded-lg shadow-2xl z-[100] text-[11px] normal-case font-medium leading-relaxed text-blue-50/90 backdrop-blur-sm opacity-0 group-hover/trace:opacity-100 transition-opacity pointer-events-none whitespace-pre-wrap">
                    <p className="font-bold text-blue-400 mb-1.5 uppercase tracking-wider text-[9px] border-b border-blue-500/20 pb-1">Trace Details</p>
                    {content}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1c212c] border-r border-b border-blue-500/50 rotate-45" />
                  </div>
                )}
              </span>
            );
          } else {
            newParts.push(<span key={`${id}-${idx}`} className={style}>{match[0]}</span>);
          }
          
          lastIndex = match.index + match[0].length;
        });

        newParts.push(part.substring(lastIndex));
      });
      parts = newParts;
    });

    return parts;
  };

  return (
    <div className="h-screen bg-app-bg text-gray-200 font-sans flex flex-col overflow-hidden">
      {/* Header / Top Bar */}
      <header className="sticky top-0 bg-app-surface border-b border-app-border px-6 py-3 flex justify-between items-center z-30 shadow-md shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded text-white">
              <Terminal size={20} />
            </div>
            <h1 className="text-lg font-bold tracking-tight hidden sm:block">Relay Finder</h1>
          </div>

          <div className="h-6 w-px bg-app-border mx-2 hidden sm:block" />

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-app-bg border border-app-border rounded p-1 group relative">
              <div className="relative">
                <input
                  type="text"
                  value={myNodeId}
                  onChange={(e) => setMyNodeId(e.target.value)}
                  placeholder="Node ID (!...)"
                  className="w-32 pl-7 pr-2 py-1 bg-transparent border-none text-xs font-mono focus:ring-0 outline-none"
                  title="Your Node ID (e.g. !9e7620e0)"
                />
                <Search className="absolute left-2 top-2 text-gray-500" size={12} />
              </div>
              
              <div className="h-4 w-px bg-app-border mx-1" />
              
              <div className="flex items-center gap-2 px-2 py-0.5 cursor-help">
                <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Collect All</span>
                <button 
                  onClick={() => setCollectAllStats(!collectAllStats)}
                  className={`w-7 h-3.5 rounded-full transition-all relative ${collectAllStats ? 'bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.4)]' : 'bg-gray-600'}`}
                >
                  <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all ${collectAllStats ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>

              <div className="absolute top-full left-0 mt-2 w-64 p-3 bg-app-surface border border-app-border rounded shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-xs normal-case font-medium leading-relaxed text-gray-300">
                <p className="font-bold text-orange-400 mb-2 uppercase tracking-wider border-b border-orange-500/20 pb-1">Node Tracking Mode</p>
                <p className="mb-3">Enter your Node ID to track your own messages in the terminal.</p>
                <div className="pt-2 border-t border-app-border/50">
                  <p>
                    <span className="text-orange-400 font-semibold">COLLECT ALL:</span> When ON, signal stats for ALL rebroadcasts on the mesh will be added to the side panel, even if they aren't yours. This is useful for antenna adjusting.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-app-bg border border-app-border rounded text-[11px] font-bold group relative cursor-help">
              <span className="text-gray-500 uppercase tracking-wider">Filter System</span>
              <button 
                onClick={() => setFilterTelemetry(!filterTelemetry)}
                className={`w-8 h-4 rounded-full transition-all relative ${filterTelemetry ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]' : 'bg-gray-600'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${filterTelemetry ? 'left-4.5' : 'left-0.5'}`} />
              </button>
              <div className="absolute top-full left-0 mt-2 w-56 p-3 bg-app-surface border border-app-border rounded shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-xs normal-case font-medium leading-relaxed text-gray-300">
                <p className="font-bold text-blue-400 mb-1 uppercase tracking-wider">System Filter</p>
                When ON, it hides background traffic like position updates and telemetry, showing only your messages and their relays.
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Stats and Clear Button */}
          <div className="hidden lg:flex items-center gap-5 border-r border-app-border pr-5 mr-1">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none mb-1">Tracked</span>
              <span className="text-sm font-mono font-bold text-blue-400 leading-none">{trackedPacketIds.length}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none mb-1">Logs</span>
              <span className="text-sm font-mono font-bold text-gray-400 leading-none">{logs.length}</span>
            </div>
            <button 
              onClick={clearAll}
              className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/5 hover:bg-orange-500/10 text-orange-400 hover:text-orange-300 border border-orange-500/10 hover:border-orange-500/30 rounded text-[11px] font-bold transition-all uppercase tracking-wider"
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[10px] font-black text-gray-500 w-32 shrink-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${isReceiving ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            <span className="truncate">
              {isConnected ? (isReceiving ? 'RECEIVING DATA' : 'CONNECTED') : 'OFFLINE'}
            </span>
          </div>
          
          <div className="flex gap-2">
            {!isConnected ? (
              <button 
                onClick={connect} 
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-[11px] uppercase tracking-wider transition-all shadow-sm"
              >
                <Usb size={14} /> Connect
              </button>
            ) : (
              <button 
                onClick={disconnect} 
                className="flex items-center gap-2 px-4 py-1.5 border border-app-border hover:bg-app-surface text-gray-300 rounded font-bold text-[11px] uppercase tracking-wider transition-all"
              >
                <RefreshCw size={14} className={isReceiving ? "animate-spin" : ""} /> Disconnect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left Status Panel */}
        <aside className="w-72 bg-app-surface border-r border-app-border flex flex-col shrink-0">
          <div className="p-4 border-b border-app-border">
            <div className="flex bg-app-bg p-1 rounded-lg border border-app-border">
              <button 
                onClick={() => setRelayViewMode('by-node')}
                className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-all ${relayViewMode === 'by-node' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
              >
                By Nodes
              </button>
              <button 
                onClick={() => setRelayViewMode('by-packet')}
                className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-all ${relayViewMode === 'by-packet' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
              >
                By Packets
              </button>
            </div>
          </div>

          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4" 
            ref={relayListRef}
            onScroll={handleRelayScroll}
          >
            <section>
              <div className="space-y-2">
                {relayViewMode === 'by-node' ? (
                  relayNodes.length > 0 ? relayNodes.map(node => (
                    <motion.div 
                      initial={{ x: -10, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      key={node.byte} 
                      className="bg-app-surface border border-app-border rounded shadow-sm"
                    >
                      <div className="bg-app-surface/50 px-3 py-1.5 flex justify-between items-center border-b border-app-border">
                        <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Relay Byte</span>
                        <span className="text-orange-400 font-mono font-bold text-sm">0x{node.byte}</span>
                      </div>
                      
                      <div className="p-2">
                        <div className="grid grid-cols-3 gap-2 mb-1.5 px-1 border-b border-app-border pb-1">
                          <span className="text-[11px] text-gray-600 font-bold uppercase tracking-wider">SNR</span>
                          <span className="text-[11px] text-gray-600 font-bold uppercase tracking-wider">RSSI</span>
                          <span className="text-[11px] text-gray-600 font-bold uppercase tracking-wider text-right">Packet</span>
                        </div>
                        <div className="space-y-0.5">
                          {(() => {
                            const groups: {id: string, items: typeof node.entries}[] = [];
                            node.entries.forEach(entry => {
                              const last = groups[groups.length - 1];
                              if (last && last.id === entry.id) {
                                last.items.push(entry);
                              } else {
                                groups.push({ id: entry.id, items: [entry] });
                              }
                            });

                            return groups.map((group, gIdx) => (
                              <div key={gIdx} className={`space-y-0 ${gIdx > 0 ? 'pt-0.5 border-t border-app-border/20' : ''}`}>
                                  {group.items.map((entry, idx) => (
                                    <div key={idx} className="grid grid-cols-3 gap-2 px-1 items-center hover:bg-white/5 rounded transition-colors py-0.5">
                                      <div className={`text-xs font-mono font-bold flex items-center gap-1 ${getSnrColor(entry.snr)}`}>
                                        <span className="whitespace-nowrap">
                                          {entry.snr ? `${entry.snr} dB` : '—'}
                                        </span>
                                        <span className="text-[10px] opacity-70">
                                          {group.items.length > 1 ? (
                                            (entry as any).isOutbound ? '↑' : '↓'
                                          ) : (
                                            (entry as any).isOutbound ? '↑' : ''
                                          )}
                                        </span>
                                      </div>
                                      <span className={`text-xs font-mono font-bold ${getRssiColor(entry.rssi)}`}>
                                        {entry.rssi ? `${entry.rssi} dBm` : '—'}
                                      </span>
                                    <div className="relative group/packet flex justify-end">
                                      <span className={`font-mono text-xs text-right truncate ${trackedPacketIds.includes(entry.id) && packetMessages[entry.id] ? 'cursor-help' : ''} ${trackedPacketIds.includes(entry.id) ? 'text-blue-400' : 'text-gray-500'}`}>
                                        {idx === 0 ? entry.id : ''}
                                      </span>
                                      {idx === 0 && trackedPacketIds.includes(entry.id) && packetMessages[entry.id] && (
                                        <div className="absolute bottom-full right-0 mb-3 w-56 p-3 bg-[#1c212c] border border-blue-500/50 rounded-lg shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] opacity-0 group-hover/packet:opacity-100 transition-all duration-200 pointer-events-none z-[100] text-[11px] normal-case font-medium leading-relaxed text-blue-50/90 backdrop-blur-sm">
                                          <div className="relative z-10">
                                            <p className="font-bold text-blue-400 mb-1.5 uppercase tracking-wider text-[9px] border-b border-blue-500/20 pb-1">Message Content</p>
                                            <div className="italic text-gray-300">
                                              "{packetMessages[entry.id]}"
                                            </div>
                                          </div>
                                          <div className="absolute -bottom-1.5 right-4 w-3 h-3 bg-[#1c212c] border-r border-b border-blue-500/50 rotate-45 z-0" />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </motion.div>
                  )) : (
                    <div className="py-10 border border-dashed border-app-border rounded flex flex-col items-center justify-center text-gray-600">
                      <RefreshCw size={20} className="opacity-20 mb-2" />
                      <span className="text-[10px] font-bold uppercase tracking-tighter">No relays yet</span>
                    </div>
                  )
                ) : (
                  // By Packet View
                  (() => {
                      const displayPacketIds = allSeenPacketIds.filter(id => 
                        trackedPacketIds.includes(id) || 
                        (collectAllStats && relayNodes.some(n => n.entries.some(e => e.id === id)))
                      );
                      
                      return displayPacketIds.length > 0 ? displayPacketIds.map(packetId => {
                        const relaysForThisPacket = relayNodes.flatMap(n => 
                          n.entries
                            .filter(e => e.id === packetId)
                            .map(e => ({ byte: n.byte, snr: e.snr, rssi: e.rssi, isOutbound: (e as any).isOutbound }))
                        );
                        const isOurs = trackedPacketIds.includes(packetId);
                      
                      return (
                        <motion.div 
                          initial={{ x: -10, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          key={packetId} 
                          className="bg-app-surface border border-app-border p-2 rounded flex flex-col gap-1 shadow-sm"
                        >
                          <div className="flex justify-between items-center border-b border-app-border pb-1">
                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Packet</span>
                            <div className="relative group/packet flex justify-end">
                              <span className={`font-mono text-[11px] ${isOurs && packetMessages[packetId] ? 'cursor-help' : ''} ${isOurs ? 'text-blue-400' : 'text-gray-500'}`}>
                                {packetId}
                              </span>
                              {isOurs && packetMessages[packetId] && (
                                <div className="absolute bottom-full right-0 mb-3 w-56 p-3 bg-[#1c212c] border border-blue-500/50 rounded-lg shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] opacity-0 group-hover/packet:opacity-100 transition-all duration-200 pointer-events-none z-[100] text-[11px] normal-case font-medium leading-relaxed text-blue-50/90 backdrop-blur-sm">
                                  <div className="relative z-10">
                                    <p className="font-bold text-blue-400 mb-1.5 uppercase tracking-wider text-[9px] border-b border-blue-500/20 pb-1">Message Content</p>
                                    <div className="italic text-gray-300">
                                      "{packetMessages[packetId]}"
                                    </div>
                                  </div>
                                  {/* Arrow/Tail */}
                                  <div className="absolute -bottom-1.5 right-4 w-3 h-3 bg-[#1c212c] border-r border-b border-blue-500/50 rotate-45 z-0" />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {relaysForThisPacket.length > 0 ? relaysForThisPacket.map(r => (
                              <div key={r.byte} className="flex flex-col gap-1 bg-orange-500/10 border border-orange-500/30 p-1.5 rounded min-w-[60px]">
                                <span className="text-orange-400 font-mono font-bold text-center border-b border-orange-500/20 pb-1 mb-1">
                                  0x{r.byte}
                                </span>
                                <div className="flex justify-between items-center text-[10px] font-mono">
                                  <span className="text-gray-500 uppercase tracking-wider font-bold text-[9px]">SNR</span>
                                  <div className={`flex items-center gap-0.5 ${getSnrColor(r.snr)}`}>
                                    <span className="whitespace-nowrap">
                                      {r.snr ? `${r.snr} dB` : '?'}
                                    </span>
                                    <span className="text-[9px] opacity-70">
                                      {relaysForThisPacket.filter(rp => rp.byte === r.byte).length > 1 ? (
                                        r.isOutbound ? '↑' : '↓'
                                      ) : (
                                        r.isOutbound ? '↑' : ''
                                      )}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between text-[10px] font-mono">
                                  <span className="text-gray-500 uppercase tracking-wider font-bold text-[9px]">RSSI</span>
                                  <span className={getRssiColor(r.rssi)}>{r.rssi ? `${r.rssi} dBm` : '?'}</span>
                                </div>
                              </div>
                            )) : (
                              <span className="text-[9px] text-gray-600 italic">Waiting for relay...</span>
                            )}
                          </div>
                        </motion.div>
                      );
                    }) : (
                      <div className="py-10 border border-dashed border-app-border rounded flex flex-col items-center justify-center text-gray-600">
                        <RefreshCw size={20} className="opacity-20 mb-2" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter">No packets tracked</span>
                      </div>
                    );
                  })()
                )}
              </div>
            </section>
          </div>

          <section className="mt-auto p-3 border-t border-app-border">
            <div className="text-center">
              <a 
                href="https://le-francais.ru" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm font-medium text-gray-400 hover:text-blue-400 transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Powered by</span>
                <svg 
                  viewBox="0 0 467.32 329.23" 
                  className="h-4 w-auto inline-block relative -top-[2px] left-[2px]"
                  fill="#ed1c24"
                >
                  <path 
                    transform="translate(-255.01, -188.36)" 
                    d="M566.78,205.68c-28.78,28.37-59.1,56.19-65.55,102.06,16.31,4.46,33,7.44,48.48,13.58,39.3,15.61,80.3,28.86,116.14,50.49,21.53,13,38.76,37.83,50.53,61.09,16.25,32.09-2.29,71.48-37.2,71.75-111.08.85-223.27,33.09-333.22-7.5-18.51-6.83-37-15.17-53.39-26-42.46-28.06-48.95-70.82-19.34-112.53,20.9-29.45,48.15-50.16,84.39-53.34,34-3,68.42-2.71,102.56-1.44,14.63.55,21.44-2.64,24.65-17,4.93-22,11.1-43.8,17.36-65.5C513.24,183.09,529.68,178.45,566.78,205.68Z" 
                  />
                </svg>
                <span className="text-white hover:text-blue-400 transition-colors">le-francais.ru</span>
              </a>
            </div>
          </section>
        </aside>

        {/* Log Terminal */}
        <section className="flex-1 flex flex-col bg-app-bg relative">
          <div className="absolute top-4 right-6 z-10">
            <button 
              onClick={() => setAutoScroll(!autoScroll)}
              className={`px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all border ${autoScroll ? 'bg-blue-600/20 text-blue-400 border-blue-500/50' : 'bg-app-border text-gray-500 border-app-border'}`}
            >
              {autoScroll ? 'AUTO-SCROLL: ON' : 'AUTO-SCROLL: OFF'}
            </button>
          </div>

          <div 
            ref={logsContainerRef}
            onScroll={handleLogScroll}
            className="flex-1 overflow-y-auto p-6 font-mono text-[12px] leading-relaxed scrollbar-thin"
          >
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center grayscale">
                <Terminal size={48} className="mb-4" />
                <p className="text-sm font-bold uppercase tracking-widest">Awaiting Serial Data</p>
                <p className="text-[10px] mt-2">Connect node and send a message to start tracking</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <div 
                    key={log.id} 
                    className={`group flex gap-3 py-0.5 px-2 rounded hover:bg-white/5 transition-colors ${
                      log.type === 'info' ? 'text-blue-400' : 
                      log.type === 'success' ? 'text-green-400 font-bold bg-green-500/5' : 
                      log.type === 'warning' ? 'text-amber-400' : 
                      log.type === 'error' ? 'text-red-400' : 'text-gray-400'
                    }`}
                  >
                    <span className="text-gray-600 shrink-0 select-none w-16">[{log.timestamp}]</span>
                    <span className="break-all">{renderHighlightedLog(log.text, log.id)}</span>
                  </div>
                ))}
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </section>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .scrollbar-thin::-webkit-scrollbar { width: 6px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: var(--color-app-border); border-radius: 10px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: var(--color-app-surface); }
      `}} />
    </div>
  );
}

