export const apngCodecWorkerContent = `
    self.onmessage = e => {
        console.log("Worker: Message recevied");
        const {buffers, w, h, delays, workerScriptUrls} = e.data;
        importScripts(...workerScriptUrls);
        console.log("Encoding...");
        console.time("Encode");
        const arrayBuffer = APNGCodec.encode(buffers, w, h, 0, delays);
        console.timeEnd("Encode");
        e.target.postMessage({arrayBuffer});
    };
`;
