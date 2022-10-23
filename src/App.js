/* eslint-disable no-undef */
import logo from './logo.svg';
import './App.css';
import React, { useEffect, useMemo, useState } from 'react';

/*
const input = document.createElement("input");
input.type = "file";
document.body.append(input);
input.addEventListener("change", async event => {
    const ab = await input.files[0].arrayBuffer();
    const ui8a = new Uint8Array(ab);
    console.log("Uint8Array", ui8a);
});
*/

/**
 * This function turns a buffer into an array of different buffers of specified size
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 * Parameters:
 *  buffer - buffer that should be partitioned
 *  max - the maximum of the buffer
 * Returns:
 *  array - an array of buffers containing the proper syntax
 */
function bufferPartitioner(buffer, max) {
  let output = [];
  const buffer_size = max;
  let size = Math.ceil(buffer.length / buffer_size);

  for (let i = 0; i < size; i++) {
    let sub_buffer = buffer.subarray(i * (buffer_size - 2), (i+1) * (buffer_size - 2));
    let new_buffer = new Uint8Array(buffer_size);  // max is 1218
    new_buffer["0"] = size;
    new_buffer["1"] = i;
    new_buffer.set(sub_buffer, 2);
    output.push(new_buffer);
  }
  return output;
}

/**
 * This function turns an array of buffers into a single byte array
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 * Parameters:
 *  array - the array of buffers to be concatonated
 */
function bufferArrayConcat(array) {
  // make sure to replace 1200 with an actual variable from either the buffers a global const
  let fake_buffer = new Array(array[0]["0"] * (1200 - 3));
  for (let element of array) {
    let index = element["1"];
    let data = element.subarray(2);
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

      // receiving datagram, should equal whats sent
      let finished = false;
      let array = [];
      while (!finished) {
        await reader.ready;
        const {value, done} = await reader.read();
        set_data(value);
        array.push(value);
        console.log(bufferArrayConcat(array));
        // console.log(value, done);
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
      let data_array = bufferPartitioner(sending_data, 1200);
      for (let data of data_array) {
        await writer.ready;
        await writer.write(data);
      }
    }
    if (sending_data) {
      begin();
    }
  }, [sending_data, writer]);

  return (
    <div>
      Image: <input type="file" id="img" accept="image/png, image/jpeg" onChange={ async (e) => {
        set_sending_data(new Uint8Array(await e.target.files[0].arrayBuffer()));
		  }} />
      Received Data: { JSON.stringify(data) }
    </div>
  );
}

export default App;