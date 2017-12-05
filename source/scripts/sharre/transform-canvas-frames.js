import {
    defaultPrefix,
    defaultSuffix,
    resolveBlobs,
} from "./share-between-pages.js";
import {transferType} from "../base/register.js";
import {apngCodecWorkerContent} from "./apng-codec-worker.js";

export const transformCanvasFrames = canvas => {
    if (!(canvas && canvas.tagName && canvas.tagName.toUpperCase() === "CANVAS")) {
        throw new Error("The first paramater should be a canvas element");
    }
    const checkout = {
        animation: false,
        sampleRate: 50,
    };
    const tolerant = {
        upper: 5,
        lower: 1,
        ratio: 0.02,
    };
    const recorder = {
        tid: null,
        stime: 0,
        etime: 0,
        sindex: 0,
        eindex: 0,
        check: false,
    };
    const fragment = [];
    const primaryTimeout = 5 * 1000;
    const totalityTimeout = 60 * 1000;
    const context = canvas.getContext("2d");
    const isEqualView = (buf1, buf2) => {
        // @see https://bugs.chromium.org/p/chromium/issues/detail?id=786381
        const buffer1 = new Uint8Array(buf1);
        const buffer2 = new Uint8Array(buf2);
        if (buffer1.byteLength === buffer2.byteLength) {
            return buffer1.every((value, index) => value === buffer2[index]);
        } else {
            return false;
        }
    };
    const w = canvas.width;
    const h = canvas.height;

    recorder.stime = recorder.etime = Date.now();
    recorder.tid = setInterval(() => {
        recorder.etime = Date.now();
        if (recorder.etime - recorder.stime > totalityTimeout * 1.5) {
            clearInterval(recorder.tid);
            console.warn(`Timeout: 1.5 times ${totalityTimeout} milliseconds has run out. Force exit`);
            return;
        }
        if (canvas.width !== w || canvas.height !== h) {
            throw new Error("Canvas width/height has changed");
        }
        try {
            const imgData = context.getImageData(0, 0, w, h);
            if (!checkout.animation && recorder.etime - recorder.stime > primaryTimeout) {
                clearInterval(recorder.tid);
                canvas.toBlob(blob => resolveBlobs([blob], {
                    writeln: "clipboard",
                }, defaultPrefix, defaultSuffix), "image/png");
                return;
            }
            if (!recorder.check && recorder.etime - recorder.stime > totalityTimeout) {
                clearInterval(recorder.tid);
                console.warn(`Timeout: ${totalityTimeout} milliseconds has run out`);
                return;
            }

            if (!fragment.length || !isEqualView(fragment[fragment.length - 1].imgData.data, imgData.data)) {
                fragment.push({
                    imgData: imgData,
                    timeStamp: recorder.etime,
                });
            }
            if (fragment.length >= 2) {
                checkout.animation = true;
            }
            if (fragment.length <= 2) {
                return;
            }
            const first = fragment[0];
            const latest = fragment[fragment.length - 1];
            if (isEqualView(first.imgData.data, latest.imgData.data) && !recorder.check) {
                recorder.check = true;
                recorder.sindex = fragment.length - 1;
                recorder.eindex = 2 * recorder.sindex;
            }
            if (recorder.check && fragment.length - 1 === recorder.eindex) {
                const stats = {done: 0, fail: 0};
                for (let i = 0; i < recorder.sindex; i++) {
                    if (isEqualView(fragment[i].imgData.data, fragment[i + recorder.sindex].imgData.data)) {
                        stats.done++;
                    } else {
                        stats.fail++;
                    }
                }
                const detla = Math.min(Math.max(Math.floor(recorder.sindex * tolerant.ratio), tolerant.lower), tolerant.upper);
                if (stats.fail <= detla) {
                    clearInterval(recorder.tid);
                    console.log("Frames:", fragment.length, fragment);
                    if (fragment.length) {
                        const buffers = [];
                        const delays = [];
                        for (let i = 0; i < fragment.length; i++) {
                            buffers.push(fragment[i].imgData.data.buffer);
                            delays.push(i === 0 ? 0 : fragment[i].timeStamp - fragment[i - 1].timeStamp);
                        }

                        const workerSrcUrl = `data:text/javascript;base64,${btoa(apngCodecWorkerContent)}`;
                        const apngCodecWorker = new Worker(workerSrcUrl);
                        const workerScriptUrls = [
                            chrome.runtime.getURL("APNG-Codec/classic/pako.js"),
                            chrome.runtime.getURL("APNG-Codec/classic/apng-codec.js"),
                        ];
                        apngCodecWorker.postMessage({buffers, w, h, delays, workerScriptUrls});
                        apngCodecWorker.onmessage = e => {
                            const {arrayBuffer} = e.data;
                            chrome.runtime.sendMessage({
                                type: transferType.fromCanvasFrame,
                                srcUrl: URL.createObjectURL(new Blob([arrayBuffer], {type: "image/png"})),
                            });
                        };

                        /**
                         * @see https://bugs.chromium.org/p/chromium/issues/detail?id=680046
                         * @todo Use Web Worker
                         */
                        // console.time("APNG Encoder");
                        // const arrayBuffer = APNGCodec.encode(buffers, w, h, 0, delays);
                        // console.timeEnd("APNG Encoder");
                        //
                        // chrome.runtime.sendMessage({
                        //     type: transferType.fromCanvasFrame,
                        //     srcUrl: URL.createObjectURL(new Blob([arrayBuffer], {type: "image/png"})),
                        // });
                    }
                    return;
                }
                recorder.check = false;
            }
        } catch (e) {
            e.message && console.warn(e.message);
            clearInterval(recorder.tid);
            chrome.runtime.sendMessage({
                type: transferType.fromWithoutCORSMode,
            });
        }
    }, 1000 / checkout.sampleRate);
};
