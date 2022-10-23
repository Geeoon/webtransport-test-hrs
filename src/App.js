/* eslint-disable no-undef */
import './App.css';
import React, { useEffect, useMemo, useState } from 'react';

/**
 * This function turns a buffer into an array of different buffers of specified size
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 *  3rd current message id, all messages should have the same id for the same picture
 * Parameters:
 *  buffer - buffer that should be partitioned
 *  max - the maximum of the buffer
 * Returns:
 *  array - an array of buffers containing the proper syntax
 */
function bufferPartitioner(buffer, max) { // theorhetical max 306000 bytes or 306kb
  let output = [];
  const buffer_size = max;
  let size = Math.ceil(buffer.length / buffer_size);
  let id = Math.floor(Math.random() * 256);
  for (let i = 0; i < size; i++) {
    let sub_buffer = buffer.subarray(i * (buffer_size - 3), (i+1) * (buffer_size - 3));
    let new_buffer = new Uint8Array(buffer_size);  // max is 1218
    new_buffer["0"] = size;
    new_buffer["1"] = i;
    new_buffer["2"] = id;
    new_buffer.set(sub_buffer, 3);
    output.push(new_buffer);
  }
  return output;
}

/**
 * This function turns an array of buffers into a single byte array
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 *  3rd current message id, all messages should have the same id for the same picture
 * Parameters:
 *  array - the array of buffers to be concatonated
 */
function bufferArrayConcat(array) {
  // make sure to replace 1200 with an actual variable from either the buffers a global const
  let fake_buffer = new Array(array[0]["0"] * (1200 - 3));
  for (let element of array) {
    let index = element["1"];
    let data = element.subarray(3);
    fake_buffer.splice(index * (1200 - 3), 0, ...data);
    fake_buffer = fake_buffer.splice(0, (index + 1) * (1200 - 3));
  }
  return new Uint8Array(fake_buffer);
}

const sleep = ms => new Promise(
  resolve => setTimeout(resolve, ms)
);

function App() {
  const [data, set_data] = useState(null);
  const [sending_data, set_sending_data] = useState(null);
  const [reader, set_reader] = useState(false);
  const [writer, set_writer] = useState(false);
  const [image_buffer, set_image_buffer] = useState(null);
  const [old_image, set_old_image] = useState(null);
  const transport = useMemo(async () => {
    let wt = new WebTransport('https://usa.echo.webtransport.day');
    set_reader(wt.datagrams.readable.getReader());
    set_writer(wt.datagrams.writable.getWriter());
    await wt.ready;
    return wt;  // echo server
  }, []);

  useEffect(() => {
    async function begin() {
      // file: https://cdn.theatlantic.com/media/mt/science/cool-space-picture-5.jpg

      // receiving datagram, should be similar to whats sent
      let finished = false;
      let id = 0;
      let array = [];
      while (!finished) {
        await reader.ready;
        const {value, done} = await reader.read();
        set_data(value);
        if (value["2"] !== id) {
          if (array.length > 0) {
            set_old_image(bufferArrayConcat(array));
          }
          array.length = 0;
          id = value["2"];
        }
        array.push(value);
        finished = done;
      }
    }
    if (transport) {
      begin();
    }
  }, [transport, reader]);

  useEffect(() => {
    async function begin() {
      // sending to echo server
      // max write size 1218
      while (true) {
        let data_array = bufferPartitioner(sending_data, 1200);
        for (let data of data_array) {
          await writer.ready;
          await writer.write(data);
        }
      }
    }
    if (sending_data) {
      begin();
    }
  }, [sending_data, writer]);

  return (
    <div>
      Image: <input type="file" id="img" accept="image/png, image/jpeg" onChange={ async (e) => {
        if (!e.target.files[0]) return;
        set_sending_data(new Uint8Array(await e.target.files[0].arrayBuffer()));
		  }} />
      Received Data: { JSON.stringify(data) }<br />
      <img alt="data received" src={ old_image && URL.createObjectURL(new Blob([old_image.buffer], { type: 'image/jpeg' }))}/>
    </div>
  );
}

export default App;