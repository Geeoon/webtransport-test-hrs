/* eslint-disable no-undef */
import './App.css';
import React, { useEffect, useMemo, useState } from 'react';

const FPS = 20;
let number = 0;
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
  number++;
  if (number > 255) {
    number = 0;
  }
  for (let i = 0; i < size; i++) {
    let sub_buffer = buffer.subarray(i * (buffer_size - 3), (i+1) * (buffer_size - 3));
    let new_buffer = new Uint8Array(buffer_size);  // max is 1218
    new_buffer["0"] = size;
    new_buffer["1"] = i;
    new_buffer["2"] = number;
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
function bufferArrayConcat(array, size) {
  // make sure to replace 1200 with an actual variable from either the buffers a global const
  let fake_buffer = new Array(array[0]["0"] * (size - 3));
  for (let element of array) {
    let index = element["1"];
    let data = element.subarray(3);
    fake_buffer.splice(index * (size - 3), 0, ...data);
    fake_buffer = fake_buffer.splice(0, (index + 1) * (size - 3));
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
  const [transport, set_transport] = useState(null);

  useEffect(() => {
    async function begin() {
      let wt = new WebTransport('https://usa.echo.webtransport.day');
      set_reader(wt.datagrams.readable.getReader());
      set_writer(wt.datagrams.writable.getWriter());
      await wt.ready;
      set_transport(wt);  // echo server
    }
    begin();
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
        if (value["2"] > id || id - value["2"] > 100) {  // if a new image is being received, display the old
          if (array.length > 0) {
            set_image_buffer(bufferArrayConcat(array, transport.datagrams.maxDatagramSize - 60));
          }
          array.length = 0;
          id = value["2"];
        }
        array.push(value);
        if ((value["0"] - 1) === value["1"]) {  // if last message, you can display instantly
          set_image_buffer(bufferArrayConcat(array, transport.datagrams.maxDatagramSize - 60));
          array.length = 0;
        }
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
      let data_array = bufferPartitioner(sending_data, transport.datagrams.maxDatagramSize - 60);
      for (let data of data_array) {
        await writer.ready;
        await writer.write(data);
      }
      console.log("sent image");
    }
    /* if (sending_data) {
      begin();
    } */
    if (!sending_data) {
      return;
    }
    const id = setInterval(begin, 1000 / FPS);
    return () => clearTimeout(id);
  }, [sending_data, writer, transport]);

  return (
    <div>
      Image: <input type="file" id="img" accept="image/png, image/jpeg, image/bmp, image/img" onChange={ async (e) => {
        if (!e.target.files[0]) return;
        set_sending_data(new Uint8Array(await e.target.files[0].arrayBuffer()));
		  }} /><br />
      <img alt="data received" src={ image_buffer && URL.createObjectURL(new Blob([image_buffer.buffer], { type: 'image/bmp' }))}/>
    </div>
  );
}

export default App;