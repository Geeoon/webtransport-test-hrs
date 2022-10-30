#!/usr/bin/env python3

# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
An example WebTransport over HTTP/3 server based on the aioquic library.
Processes incoming streams and datagrams, and
replies with the ASCII-encoded length of the data sent in bytes.
Example use:
  python3 webtransport_server.py certificate.pem certificate.key
Example use from JavaScript:
  let transport = new WebTransport("https://localhost:4433/counter");
  await transport.ready;
  let stream = await transport.createBidirectionalStream();
  let encoder = new TextEncoder();
  let writer = stream.writable.getWriter();
  await writer.write(encoder.encode("Hello, world!"))
  writer.close();
  console.log(await new Response(stream.readable).text());
This will output "13" (the length of "Hello, world!") into the console.
"""

# ---- Dependencies ----
#
# This server only depends on Python standard library and aioquic 0.9.19 or
# later. See https://github.com/aiortc/aioquic for instructions on how to
# install aioquic.
#
# ---- Certificates ----
#
# HTTP/3 always operates using TLS, meaning that running a WebTransport over
# HTTP/3 server requires a valid TLS certificate.  The easiest way to do this
# is to get a certificate from a real publicly trusted CA like
# <https://letsencrypt.org/>.
# https://developers.google.com/web/fundamentals/security/encrypt-in-transit/enable-https
# contains a detailed explanation of how to achieve that.
#
# As an alternative, Chromium can be instructed to trust a self-signed
# certificate using command-line flags.  Here are step-by-step instructions on
# how to do that:
#
#   1. Generate a certificate and a private key:
#         openssl req -newkey rsa:2048 -nodes -keyout certificate.key \
#                   -x509 -out certificate.pem -subj '/CN=Test Certificate' \
#                   -addext "subjectAltName = DNS:localhost"
#
#   2. Compute the fingerprint of the certificate:
#         openssl x509 -pubkey -noout -in certificate.pem |
#                   openssl rsa -pubin -outform der |
#                   openssl dgst -sha256 -binary | base64
#      The result should be a base64-encoded blob that looks like this:
#          "Gi/HIwdiMcPZo2KBjnstF5kQdLI5bPrYJ8i3Vi6Ybck="
#
#   3. Pass a flag to Chromium indicating what host and port should be allowed
#      to use the self-signed certificate.  For instance, if the host is
#      localhost, and the port is 4433, the flag would be:
#         --origin-to-force-quic-on=localhost:4433
#
#   4. Pass a flag to Chromium indicating which certificate needs to be trusted.
#      For the example above, that flag would be:
#         --ignore-certificate-errors-spki-list=Gi/HIwdiMcPZo2KBjnstF5kQdLI5bPrYJ8i3Vi6Ybck=
#
# See https://www.chromium.org/developers/how-tos/run-chromium-with-flags for
# details on how to run Chromium with flags.

import argparse
import asyncio
import logging
from collections import defaultdict
import math
from typing import Dict, Optional
import numpy as np
import threading
import time

from aioquic.asyncio import QuicConnectionProtocol, serve
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import H3Event, HeadersReceived, WebTransportStreamDataReceived, DatagramReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.connection import stream_is_unidirectional
from aioquic.quic.events import ProtocolNegotiated, StreamReset, QuicEvent

BIND_ADDRESS = '::1'
BIND_PORT = 4433
START_STREAM = 100
MAX_FPS = 30
logger = logging.getLogger(__name__)

def bufferPartitioner(buffer: bytearray, max: int, num :int):  # buffer is bytearray, max should be datagram max - 60 bytes
    output = []
    size = math.ceil(len(buffer) / max)
    packet_num = num
    for i in range(size):
        sub_buffer = buffer[(i * (max - 5)):((i+1) * (max - 5))]
        new_buffer = bytearray(max)
        new_buffer[0] = size
        new_buffer[1] = i
        new_buffer[2] = packet_num
        new_buffer[3] = math.floor(len(buffer) / 256)
        new_buffer[4] = len(buffer) % 256
        new_buffer[5:] = sub_buffer
        output.append(new_buffer)
    return output

"""
function bufferPartitioner(buffer, max) { // theoreitcal max of 64k
  let output = [];
  const buffer_size = max;
  let size = Math.ceil(buffer.length / buffer_size);
  number++;
  if (number > 255) {
    number = 0;
  }
  for (let i = 0; i < size; i++) {
    let sub_buffer = buffer.subarray(i * (buffer_size - 5), (i+1) * (buffer_size - 5));
    let new_buffer = new Uint8Array(buffer_size);  // max is 1218
    new_buffer["0"] = size;
    new_buffer["1"] = i;
    new_buffer["2"] = number;
    new_buffer["3"] = Math.floor(buffer.length / 256);
    new_buffer["4"] = buffer.length % 256;
    new_buffer.set(sub_buffer, 5);
    output.push(new_buffer);
  }
  return output;
}

let data_array = bufferPartitioner(sending_data, transport.datagrams.maxDatagramSize - 60);
for (let data of data_array) {
    await writer.ready;
    await writer.write(data);
}
console.log("sent image");
"""

class video_stream(threading.Thread):
    def __init__(self, session_id, http: H3Connection, protocol: QuicConnectionProtocol):
        threading.Thread.__init__(self)
        self._session_id = session_id
        self._http = http
        self._protocol = protocol
        self._counter = 0

    def run(self):
        while True:
            self._counter += 1
            if (self._counter > 255):
                self._counter = 0
            image = open("earthrise.jpg", "rb").read()
            out = bytearray(image)

            data_array = bufferPartitioner(out, 1024 - 60, self._counter)  # 1024 - 60 must match client or there will be mismatch
            for data in data_array:
                self._http.send_datagram(self._session_id, data)
            self._protocol.transmit()
            # time.sleep(1 / MAX_FPS)
            time.sleep(1 / MAX_FPS)

# CounterHandler implements a really simple protocol:
#   - For every incoming bidirectional stream, it counts bytes it receives on
#     that stream until the stream is closed, and then replies with that byte
#     count on the same stream.
#   - For every incoming unidirectional stream, it counts bytes it receives on
#     that stream until the stream is closed, and then replies with that byte
#     count on a new unidirectional stream.
#   - For every incoming datagram, it sends a datagram with the length of
#     datagram that was just received.
class CounterHandler:
    def __init__(self, session_id, http: H3Connection, protocol: QuicConnectionProtocol) -> None:
        self._session_id = session_id
        self._http = http
        self._counters = defaultdict(int)
        self._packetNum = 0
        self._stream_thread = video_stream(session_id, http, protocol)


    def h3_event_received(self, event: H3Event) -> None:
        if isinstance(event, DatagramReceived):
            output = 20
            if (event.data == START_STREAM.to_bytes(1, 'big') and (not self._stream_thread.is_alive())):
                self._stream_thread.start()

            else:
                output = 40
                self._http.send_datagram(self._session_id, output.to_bytes(1, 'big'))

    def stream_closed(self, stream_id: int) -> None:
        try:
            del self._counters[stream_id]
        except KeyError:
            pass

    def loop(event) -> None:
        pass


# WebTransportProtocol handles the beginning of a WebTransport connection: it
# responses to an extended CONNECT method request, and routes the transport
# events to a relevant handler (in this example, CounterHandler).
class WebTransportProtocol(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._http: Optional[H3Connection] = None
        self._handler: Optional[CounterHandler] = None

    def quic_event_received(self, event: QuicEvent) -> None:
        if isinstance(event, ProtocolNegotiated):
            self._http = H3Connection(self._quic, enable_webtransport=True)
        elif isinstance(event, StreamReset) and self._handler is not None:
            # Streams in QUIC can be closed in two ways: normal (FIN) and
            # abnormal (resets).  FIN is handled by the handler; the code
            # below handles the resets.
            self._handler.stream_closed(event.stream_id)

        if self._http is not None:
            for h3_event in self._http.handle_event(event):
                self._h3_event_received(h3_event)

    def _h3_event_received(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            headers = {}
            for header, value in event.headers:
                headers[header] = value
            if (headers.get(b":method") == b"CONNECT" and
                    headers.get(b":protocol") == b"webtransport"):
                self._handshake_webtransport(event.stream_id, headers)
            else:
                self._send_response(event.stream_id, 400, end_stream=True)

        if self._handler:
            self._handler.h3_event_received(event)

    def _handshake_webtransport(self,
                                stream_id: int,
                                request_headers: Dict[bytes, bytes]) -> None:
        assert(self._handler is None)
        self._handler = CounterHandler(stream_id, self._http, self)
        self._send_response(stream_id, 200)


    def _send_response(self,
                       stream_id: int,
                       status_code: int,
                       end_stream=False) -> None:
        headers = [(b":status", str(status_code).encode())]
        if status_code == 200:
            headers.append((b"sec-webtransport-http3-draft", b"draft02"))
        self._http.send_headers(
            stream_id=stream_id, headers=headers, end_stream=end_stream)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('certificate')
    parser.add_argument('key')
    args = parser.parse_args()

    configuration = QuicConfiguration(
        alpn_protocols=H3_ALPN,
        is_client=False,
        max_datagram_frame_size=65536,
    )
    configuration.load_cert_chain(args.certificate, args.key)

    loop = asyncio.get_event_loop()
    loop.run_until_complete(
        serve(
            BIND_ADDRESS,
            BIND_PORT,
            configuration=configuration,
            create_protocol=WebTransportProtocol,
        ))
    try:
        print("Listening on https://{}:{}".format(BIND_ADDRESS, BIND_PORT))
        logging.info(
            "Listening on https://{}:{}".format(BIND_ADDRESS, BIND_PORT))
        loop.run_forever()
    except KeyboardInterrupt:
        pass