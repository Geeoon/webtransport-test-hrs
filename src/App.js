/* eslint-disable no-undef */
import './App.css';
import React, { useEffect, useCallback, useState } from 'react';

const FPS = 20;
let number = 0;
/**
 * This function turns a buffer into an array of different buffers of specified size
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 *  3rd current message id, all messages should have the same id for the same picture
 *  4th and 5th are size, as such 4th * 256 + 5th;
 * Parameters:
 *  buffer - buffer that should be partitioned
 *  max - the maximum of the buffer
 * Returns:
 *  array - an array of buffers containing the proper syntax
 */
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

function equal (buf1, buf2) {
    if (buf1.byteLength != buf2.byteLength) return false;
    var dv1 = new Int8Array(buf1);
    var dv2 = new Int8Array(buf2);
    for (var i = 0 ; i != buf1.byteLength ; i++)
    {
      if (dv1[i] != dv2[i]) {
        console.log(i);
        return false;
      }
    }
    return true;
}

/**
 * This function turns an array of buffers into a single byte array
 * Format:
 *  1st buffer array size
 *  2nd current buffer index
 *  3rd current message id, all messages should have the same id for the same picture
 *  4th and 5th are size, as such 4th * 256 + 5th;
 * Parameters:
 *  array - the array of buffers to be concatonated
 */
function bufferArrayConcat(array, size) {
  let max_length = array[0]["3"] * (256) + array[0]["4"];
  let fake_buffer = new Array(max_length);
  for (let element of array) {
    let index = element["1"];
    let data = element.subarray(5);
    fake_buffer.splice(index * (size - 5), data.byteLength, ...data);
  }
  if (fake_buffer.length > max_length) {
    fake_buffer = fake_buffer.slice(0, max_length);
  }
  return new Uint8Array(fake_buffer);
}

const sleep = ms => new Promise(
  resolve => setTimeout(resolve, ms)
);

function App() {
  const [data, set_data] = useState(null);
  const [sending_data, set_sending_data] = useState(null);
  const [ready, set_ready] = useState(false);
  const [reader, set_reader] = useState(false);
  const [writer, set_writer] = useState(false);
  const [image_buffer, set_image_buffer] = useState(null);
  const [transport, set_transport] = useState(null);
  const [error, set_error] = useState(null);
  const [streaming, set_streaming] = useState(false);

  const start_video_stream = useCallback(async () => {
    let buffer = new Uint8Array(1);
    buffer["0"] = 100;
    await writer.ready;
    await writer.write(buffer);
  }, [writer]);
  useEffect(() => {
    async function begin() {
      try {
        let wt = new WebTransport('https://localhost:4433/');
        await wt.ready;
        set_reader(wt.datagrams.readable.getReader());
        set_writer(wt.datagrams.writable.getWriter());
        set_transport(wt);  // echo server
        console.log("Connected to server.");
        set_ready(true);
      } catch (err) {
        set_error(err.stack);
        console.log("Error connecting to server: " + err);
      }
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
      set_streaming(true);
      while (!finished) {
        try {
          await reader.ready;
          const {value, done} = await reader.read();
          set_data(value);
          // console.log(value);
          if (value["2"] > id || id - value["2"] > 100) {  // if a new image is being received, display the old
            if (array.length > 0) {
              set_image_buffer(bufferArrayConcat(array, transport.datagrams.maxDatagramSize - 60));
            }
            id = value["2"];
          }
          array.splice(value["1"], 1, value);
          finished = done;
          console.log("received data");
        } catch (err) {
          set_error(err.stack);
          finished = true;
        }
      }
      set_streaming(false);
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
        await writer.write(data.state);
      }
      // console.log("sent image");
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

  useEffect(() => {  // check equivolence
    if (image_buffer && sending_data) {
      //console.log("Equal?: ", equal(image_buffer, sending_data));
    }
  }, [image_buffer, sending_data]);

  return (
    <div>
    {/*
    Image: <input type="file" id="img" accept="image/png, image/jpeg, image/bmp, image/img" onChange={ async (e) => {
      if (!e.target.files[0]) return;
      set_sending_data(new Uint8Array(await e.target.files[0].arrayBuffer()));
      // set_image_buffer(new Uint8Array(await e.target.files[0].arrayBuffer()));
    }} /><br />
    */}
    { ready ?
    <>
      Start video stream: <button onClick={start_video_stream}>Start!</button>
    </>
    : "Not connected!!!"}<br />
    {}
    { error && <>{ error }<br /></> }
      <img alt="Data from server concatonized" src={ image_buffer && URL.createObjectURL(new Blob([image_buffer.buffer], { type: 'image/bmp' }))}/>
    </div>
  );
}

export default App;