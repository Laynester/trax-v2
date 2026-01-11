function traxMachine() {
    return {
        colors: [
            "bg-red",
            "bg-orange",
            "bg-yellow",
            "bg-lime",
            "bg-emerald",
            "bg-cyan",
            "bg-blue",
            "bg-purple",
            "bg-pink",
            "bg-rose",
        ],
        groups: window.groups,
        collections: window.collections.filter(Boolean),
        songs: window.songs,

        selectedCollections: [], // max 6
        selectedGroup: null,
        selectedIndex: 0,
        selectedSample: null,
        hoveredTrackId: null,
        hoverX: null,

        audioCtx: null,
        buffers: {},

        previewSource: null,

        tracks: [{ id: 1, clips: [], volume: 100, gain: 0 }],

        grid: {
            secondsPerBlock: 2,
            pxPerBeat: 45,
        },

        loadedSamples: [],

        playheadX: 0,
        playStartPlayheadX: 0,
        isPlaying: false,
        playStartTime: 0,
        activeSources: [],

        offset: 0,
        songDurationSeconds: 0,

        isFiltered: false,
        isDownloading: false,

        startTime: 0,

        volume: 0,

        config: {
            download: false,
            lowpass: false,
            volume: false,
        },

        init() {
            this.selectedCollections = [];
            this.tracks = [];
            this.loadedSamples = [];
            this.audioCtx = new AudioContext();
            this.masterFilter = this.audioCtx.createBiquadFilter();
            this.masterFilter.type = "lowpass";
            this.masterFilter.frequency.value = 20000; // fully open = no filtering
            this.masterFilter.Q.value = 0.1;

            // MASTER GAIN to prevent accidental clipping/boosting
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 0.9; // slight headroom

            // Chain: masterFilter → masterGain → destination
            this.masterFilter.connect(this.masterGain);
            this.masterGain.connect(this.audioCtx.destination);

            this.isFiltered = false;

            window.onmessage = (event) => {
                if (event.data?.type === "load-trax-string") {
                    console.log(event.data);
                    this.loadTraxString(event.data.string);
                }
            };

            let urlParams = new URLSearchParams(window.location.search);
            let config = urlParams.get('config');
            if (config) {
                let opts = config.split(';');
                if (opts.includes('download')) this.config.download = true;
                if (opts.includes('lowpass')) this.config.lowpass = true;
                if (opts.includes('volume')) this.config.volume = true;
            }
        },

        toggleMasterFilter() {
            this.isFiltered = !this.isFiltered;

            const now = this.audioCtx.currentTime;
            const targetFreq = this.isFiltered ? 300 : 20000;

            this.masterFilter.frequency.cancelScheduledValues(now);
            this.masterFilter.frequency.setTargetAtTime(targetFreq, now, 0.0); // smooth ramp
        },

        shutOffFilter() {
            this.isFiltered = true;

            this.toggleMasterFilter()
        },

        turnOnFilter() {
            this.isFiltered = false;

            this.toggleMasterFilter()
        },

        createTrack() {
            const gain = this.audioCtx.createGain();
            gain.gain.value = 1;
            const newId = this.tracks.length + 1;
            this.tracks.push({ id: newId, clips: [], volume: 100, gain });
        },



        async selectCollection(collection, force = false) {
            const index = this.selectedCollections.findIndex(
                (c) => c[0] === collection[0]
            );

            if (index !== -1) {
                // Already selected, deselect
                this.selectedCollections.splice(index, 1);
                this.tracks.forEach((track) => {
                    track.clips = track.clips.filter(
                        (clip) => clip.collectionId !== collection[0]
                    );
                });

                // Optional: clear selected sample if it belongs to this collection
                if (this.selectedSample && this.selectedSample[3] === collection[0]) {
                    this.selectedSample = null;
                    this.hoverX = null;
                    this.hoveredTrackId = null;
                }
            } else if (force || this.selectedCollections.length < 10) {
                // Only add if less than 6
                this.selectedCollections.push(collection);
                let samples = this.getSamples(collection);
                const loadPromises = samples.map(async (val) => {
                    try {
                        const buffer = await this.loadSample(val);
                        this.loadedSamples[val[4]] = buffer;
                    } catch (err) {
                        console.error("Failed to load sample", val, err);
                    }
                });
                await Promise.all(loadPromises);
            }
        },

        selectSample(sample, index = 0) {
            this.selectedSample = sample;
            this.selectedIndex = index;
        },

        getSamples(collection) {
            return this.songs.filter((s) => collection[0] === s[3]);
        },

        async loadSample(sample) {
            const file = `./samples/${sample[4]}`;
            if (this.buffers[file]) return this.buffers[file];

            const res = await fetch(file, { cache: "no-cache" });
            const buf = await res.arrayBuffer();
            this.buffers[file] = await this.audioCtx.decodeAudioData(buf);
            return this.buffers[file];
        },


        async previewSample(sample) {
            if (this.isPlaying) return;
            this.stopPreview();
            const source = this.audioCtx.createBufferSource();
            source.buffer = this.loadedSamples[sample[4]];
            source.connect(this.audioCtx.destination);

            source.start();
            this.previewSource = source;
        },

        stopPreview() {
            if (this.previewSource) {
                try {
                    this.previewSource.stop();
                } catch (e) { }
                this.previewSource.disconnect();
                this.previewSource = null;
            }
        },

        canPlaceClip(track, x, width) {
            if (this.isPlaying) return false;
            const newStart = x;
            const newEnd = x + width;

            return !track.clips.some((clip) => {
                const start = clip.x;
                const end = clip.x + clip.width;

                return newStart < end && newEnd > start;
            });
        },

        async insertClipAt(track, x) {
            if (!this.selectedSample || x === null) return;

            const buffer = this.loadedSamples[this.selectedSample[4]];
            if (!buffer) return;

            const blocks = this.selectedSample[2]; // number of blocks this sample occupies
            const blockWidth = blocks * this.grid.pxPerBeat;

            track.clips.push({
                id: crypto.randomUUID(),
                sample: this.selectedSample,
                buffer,
                x: x,
                width: Math.round(blockWidth),
                collectionId: this.selectedSample[3],
                duration: Math.round(buffer.duration), // duration per block
                sound: this.selectedSample[0],
            });
        },

        sampleColor(clip, bg = true) {
            if (!clip) return "bg-gray";
            const index = this.selectedCollections.findIndex((c) => c[0] === clip[3]);
            return (
                (bg ? this.colors[index] : this.colors[index].slice(3)) || "bg-gray"
            );
        },

        sampleIndex(clip) {
            // Find the collection
            const collection = this.selectedCollections.find(
                (c) => c[0] === clip.collectionId
            );
            if (!collection) return 99; // fallback if collection was removed

            // Get all samples for that collection
            const samples = this.getSamples(collection);

            // Find index of this clip’s sample in that array
            return samples.findIndex((s) => s[0] === clip.sample[0]) + 1;
        },

        snapToGrid(e, offset = true) {
            const rect = this.$refs.timeline.getBoundingClientRect();
            const rawX = e.clientX - rect.left;

            // Add the current offset in pixels (no multiplying by rect.width)
            const absoluteX = rawX + (offset ? this.offset : 0);

            const GRID_STEP = this.grid.pxPerBeat;
            const beat = Math.round(absoluteX / GRID_STEP);
            return beat * GRID_STEP;
        },

        createSilentBuffer(durationSeconds) {
            const buffer = this.audioCtx.createBuffer(
                1, // mono
                this.audioCtx.sampleRate * durationSeconds,
                this.audioCtx.sampleRate
            );
            // buffer is already filled with 0 → silence
            return buffer;
        },

        increaseOffset() {
            this.offset += this.grid.pxPerBeat
            this.playheadX += this.grid.pxPerBeat;
        },

        decreaseOffset() {
            if (this.offset === 0) return

            this.offset -= this.grid.pxPerBeat
            this.playheadX -= this.grid.pxPerBeat
        },

        async playSong() {
            if (!this.audioCtx) this.init();

            const GRID_STEP = this.grid.pxPerBeat;
            this.playheadX += (this.startTime / this.grid.secondsPerBlock) * GRID_STEP;
            this.playheadX = Math.round(this.playheadX / GRID_STEP) * GRID_STEP;
            this.playStartPlayheadX = this.playheadX;

            const startTime = this.audioCtx.currentTime + 0.05;
            this.playStartTime = startTime;
            this.isPlaying = true;
            this.activeSources = [];

            this.tracks.forEach((track) => {
                // Connect track gain to master filter only during playback
                track.gain.connect(this.masterFilter);

                // Set track volume
                track.gain.gain.setValueAtTime(track.volume / 100, startTime);

                const clips = [...track.clips].sort((a, b) => a.x - b.x);
                let cursorX = 0;

                clips.forEach((clip) => {
                    const buffer = clip.buffer;
                    if (!buffer) return;

                    const clipStartPx = clip.x;
                    const clipEndPx = clip.x + clip.width;

                    // Skip clips that end before current playhead
                    if (clipEndPx <= this.playheadX) return;

                    const timePerBlock = Math.round(buffer.duration);
                    const secondsPerPx = timePerBlock / clip.width;

                    // Determine if playhead is inside this clip
                    const playheadInsideClip = this.playheadX >= clipStartPx && this.playheadX < clipEndPx;

                    if (playheadInsideClip) {
                        // Start playing immediately from the offset within the clip
                        const offsetPx = this.playheadX - clipStartPx;
                        const offsetSeconds = offsetPx * secondsPerPx;

                        const source = this.audioCtx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(track.gain);
                        source.start(startTime, offsetSeconds);
                        this.activeSources.push(source);
                    } else {
                        // Clip is ahead of playhead
                        // Gap before clip (if any)
                        if (clip.x > Math.max(cursorX, this.playheadX)) {
                            const gapStartPx = Math.max(cursorX, this.playheadX);
                            const gapPx = clip.x - gapStartPx;
                            const gapSeconds = gapPx * secondsPerPx;

                            if (gapSeconds > 0) {
                                const silentBuffer = this.createSilentBuffer(gapSeconds);
                                const silentSource = this.audioCtx.createBufferSource();
                                silentSource.buffer = silentBuffer;
                                silentSource.connect(track.gain);
                                const gapStartTime = startTime + (gapStartPx - this.playheadX) * secondsPerPx;
                                silentSource.start(gapStartTime);
                            }
                        }

                        // Play actual clip from the beginning
                        const delayPx = clipStartPx - this.playheadX;
                        const clipStartTime = startTime + delayPx * secondsPerPx;

                        const source = this.audioCtx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(track.gain);
                        source.start(clipStartTime);
                        this.activeSources.push(source);
                    }

                    cursorX = clip.x + clip.width;
                });
            });

            // Calculate remaining duration from playhead position
            const totalPixels = this.getTotalTimelinePixels();
            const secondsPerPx = this.getSecondsPerPx();
            const remainingPixels = totalPixels - this.playheadX;
            this.songDurationSeconds = remainingPixels * secondsPerPx;
            this.updatePlayhead();
        },

        getTotalTimelinePixels() {
            return this.tracks.reduce((max, track) => {
                const trackEnd = track.clips.reduce(
                    (end, clip) => Math.max(end, clip.x + clip.width),
                    0
                );
                return Math.max(max, trackEnd);
            }, 0);
        },

        getSecondsPerPx() {
            // assumes all clips share the same grid scale
            const clip = this.tracks[0]?.clips[0];
            if (!clip) return 0;

            const timePerBlock = Math.round(clip?.buffer?.duration);

            return timePerBlock / clip.width;
        },

        getSongDurationSeconds() {
            const totalPixels = this.getTotalTimelinePixels();
            const secondsPerPx = this.getSecondsPerPx();

            return totalPixels * secondsPerPx;
        },

        updatePlayhead() {
            if (!this.isPlaying) return;

            const now = this.audioCtx.currentTime;
            const elapsed = now - this.playStartTime;

            if (elapsed >= (this.songDurationSeconds) && (this.startTime > 0)) {
                this.stopSong();
                return;
            }

            // Stop condition
            if (elapsed >= (this.songDurationSeconds)) {
                this.restartSongFrom();
                this.playSong()
                return;
            }

            // How many 2-second intervals have passed
            const INTERVAL = this.grid.secondsPerBlock; // seconds
            const steps = Math.max(0, Math.floor(elapsed / INTERVAL));

            // Move playhead by grid blocks per interval, STARTING from where we began
            const GRID_STEP = this.grid.pxPerBeat; // pixels per grid block
            this.playheadX = this.playStartPlayheadX + (steps * GRID_STEP);

            // Optional: clamp so it never goes past timeline
            const totalPixels = this.getTotalTimelinePixels();
            this.playheadX = Math.min(this.playheadX, totalPixels);

            // --- Step 2: page-based offset logic ---
            const timelineWidth = this.$refs.timeline.clientWidth;

            // How many blocks fit in the view
            const blocksPerPage = Math.floor(timelineWidth / GRID_STEP) - 2;

            // Right edge of current visible timeline in px
            const rightEdge = this.offset + blocksPerPage * GRID_STEP;

            // If playhead is beyond right edge, move offset by one page
            if (this.playheadX > rightEdge) {
                this.offset += blocksPerPage * GRID_STEP;
            }

            this.offset = Math.max(0, this.offset);

            requestAnimationFrame(() => this.updatePlayhead());
        },

        restartSongFrom() {
            this.isPlaying = false;
            this.playheadX = this.playStartPlayheadX;
            this.offset = this.playStartPlayheadX

            this.activeSources.forEach((source) => {
                try {
                    source.stop();
                } catch (e) { }
                source.disconnect();
            });

            this.activeSources = [];
        },

        pauseSong() {
            this.isPlaying = false;

            this.activeSources.forEach((source) => {
                try {
                    source.stop();
                } catch (e) { }
                source.disconnect();
            });

            this.activeSources = [];
        },

        stopSong() {
            this.isPlaying = false;
            this.playheadX = 0;
            this.offset = 0

            this.activeSources.forEach((source) => {
                try {
                    source.stop();
                } catch (e) { }
                source.disconnect();
            });

            this.activeSources = [];
        },
        deleteClip(track, clip) {
            if (this.isPlaying) return false;
            const index = track.clips.findIndex((c) => c.id === clip.id);
            if (index !== -1) {
                track.clips.splice(index, 1);
            }
        },

        clearSong() {
            if (this.isPlaying) return false;
            this.shutOffFilter();
            this.tracks = []
        },
        async exportSong() {
            if (!this.audioCtx) this.init();

            // Calculate total song duration in seconds
            let maxTime = 0;

            this.tracks.forEach((track) => {
                let cursorX = 0;
                const clips = [...track.clips].sort((a, b) => a.x - b.x);

                clips.forEach((clip) => {
                    if (!clip.buffer) return;

                    const timePerBlock = Math.round(clip.buffer.duration);
                    const secondsPerPx = timePerBlock / clip.width;

                    // Gap before clip
                    if (clip.x > cursorX) {
                        const gapPx = clip.x - cursorX;
                        const gapSeconds = gapPx * secondsPerPx;
                        cursorX += gapPx;
                        maxTime = Math.max(
                            maxTime,
                            (cursorX / clip.width) * clip.buffer.duration
                        );
                    }

                    // Clip itself
                    cursorX = clip.x + clip.width;
                    const clipEndTime = clip.x * secondsPerPx + clip.buffer.duration;
                    maxTime = Math.max(maxTime, clipEndTime);
                });
            });

            // Add tiny padding for tails
            maxTime += 0.5;

            // Create OfflineAudioContext
            const offlineCtx = new OfflineAudioContext(
                2,
                Math.ceil(22050 * maxTime),
                22050
            );

            // Master filter
            const masterFilter = offlineCtx.createBiquadFilter();
            masterFilter.type = "lowpass";
            masterFilter.frequency.value = this.isFiltered ? 300 : 20000;
            masterFilter.Q.value = 1;

            const masterGain = offlineCtx.createGain();
            masterGain.gain.value = 0.9;

            masterFilter.connect(masterGain);
            masterGain.connect(offlineCtx.destination);

            // Schedule all tracks
            this.tracks.forEach((track) => {
                const trackGain = offlineCtx.createGain();
                trackGain.gain.value = track.volume / 100;
                trackGain.connect(masterFilter);

                const clips = [...track.clips].sort((a, b) => a.x - b.x);
                let cursorX = 0;

                clips.forEach((clip) => {
                    if (!clip.buffer) return;

                    const timePerBlock = Math.round(clip.buffer.duration);
                    const secondsPerPx = timePerBlock / clip.width;

                    // Gap before clip
                    if (clip.x > cursorX) {
                        const gapPx = clip.x - cursorX;
                        const gapSeconds = gapPx * secondsPerPx;

                        if (gapSeconds > 0) {
                            const silentBuffer = this.createSilentBuffer(
                                gapSeconds,
                                offlineCtx.sampleRate
                            );
                            const silentSource = offlineCtx.createBufferSource();
                            silentSource.buffer = silentBuffer;
                            silentSource.connect(trackGain);
                            const gapStartTime = cursorX * secondsPerPx;
                            silentSource.start(gapStartTime);
                        }
                    }

                    // Actual clip
                    const clipStartTime = clip.x * secondsPerPx;
                    const source = offlineCtx.createBufferSource();
                    source.buffer = clip.buffer;
                    source.connect(trackGain);
                    source.start(clipStartTime);

                    cursorX = clip.x + clip.width;
                });
            });

            // Render and return
            return await offlineCtx.startRendering();
        },
        async exportAndDownload() {
            if (this.isDownloading) return;
            this.isDownloading = true;
            const buffer = await this.exportSong();
            const wavBlob = audioBufferToWav(buffer);

            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "trax_song.wav";
            a.click();
            URL.revokeObjectURL(url);
            this.isDownloading = false
        },
        get traxString() {
            return (this.tracks
                .map((track) => {
                    const clips = [...track.clips].sort(
                        (a, b) => (a?.x ?? 0) - (b?.x ?? 0)
                    );

                    let cursorBlocks = 0;
                    const result = [];

                    clips.forEach((clip) => {
                        if (!clip) return;

                        const clipStartBlocks = Math.round(clip.x / this.grid.pxPerBeat);

                        const clipBlocks = parseInt(clip.sample[2]); // 🔑 canonical length

                        // 🟦 GAP
                        const gapBlocks = clipStartBlocks - cursorBlocks;
                        if (gapBlocks > 0) {
                            result.push({ sound: 0, duration: gapBlocks });
                        }

                        // 🟩 CLIP (merge if possible)
                        const last = result[result.length - 1];
                        if (last && last.sound === clip.sound && gapBlocks === 0) {
                            last.duration += clipBlocks;
                        } else {
                            result.push({
                                sound: clip.sound,
                                duration: clipBlocks,
                            });
                        }

                        cursorBlocks = clipStartBlocks + clipBlocks;
                    });

                    return `${track.id}${track.volume !== 100 ? `-${track.volume}` : ''}:${result
                        .map((r) => `${r.sound},${r.duration}`)
                        .join(";")}`;
                })
                .join(":")) + (this.isFiltered ? '--lowpass' : '');
        },

        importString() {
            const value = prompt("Paste your trax string:");

            if (value !== null) {
                this.loadTraxString(value);
            }
        },
        async loadTraxString(traxString) {
            const app = this; // your Alpine traxMachine instance
            const pxPerBlock = this.grid.pxPerBeat;

            const tracks = [];

            const options = traxString.split('--lowpass')

            this.shutOffFilter()
            if (options.length > 1) this.turnOnFilter()

            // First, determine which song IDs are used
            const usedCollectionIds = new Set();
            const sections = options[0].split(":");
            for (let i = 1; i < sections.length; i += 2) {
                // clips parts
                const clips = sections[i].split(";");
                clips.forEach((str) => {
                    const [soundStr] = str.split(",");
                    const sound = parseInt(soundStr);
                    if (sound && this.songs.find((s) => parseInt(s[0]) === sound))
                        usedCollectionIds.add(
                            this.songs.filter((song) => song[0] == sound)[0][3]
                        );
                });
            }

            const collectionsToLoad = this.collections.filter((col) =>
                usedCollectionIds.has(col[0])
            );

            const loadPromises = collectionsToLoad.map((col) =>
                this.selectCollection(col, true)
            );

            // Wait for all collections to finish loading
            await Promise.all(loadPromises);

            for (let i = 0; i < sections.length; i += 2) {
                const [idStr, volumeStr] = sections[i].split("-");
                const trackId = parseInt(idStr);
                const volume = volumeStr ? Math.min(100, Math.max(1, parseInt(volumeStr))) : 100;
                const clipsPart = sections[i + 1];
                if (!trackId || !clipsPart) continue;

                const clipStrings = clipsPart.split(";");
                const clips = [];
                let cursorX = 0;

                clipStrings.forEach((str) => {
                    const [soundStr, blockCountStr] = str.split(",");
                    const sound = parseInt(soundStr);
                    const totalBlocks = parseInt(blockCountStr); // how many blocks this clip occupies

                    if (sound === 0) {
                        // Gap
                        cursorX += totalBlocks * pxPerBlock;
                        return;
                    }

                    const buffer =
                        this.loadedSamples[`sound_machine_sample_${sound}.mp3`];
                    const sample = this.songs.find((song) => song[0] == sound);

                    if (!buffer || !sample) return;

                    const blocksPerSample = Math.round(Math.round(buffer.duration) / 2); // [2] = how many blocks the original sample spans
                    const clipWidth = pxPerBlock * blocksPerSample;

                    // Number of clips to create
                    const repeatCount = Math.ceil(totalBlocks / blocksPerSample);

                    for (let i = 0; i < repeatCount; i++) {
                        const width = clipWidth;
                        const clip = {
                            id: crypto.randomUUID(),
                            sample,
                            buffer,
                            x: Math.round(cursorX),
                            width,
                            collectionId: sample[3],
                            duration: Math.round(buffer.duration),
                            sound: sound,
                        };

                        clips.push(clip);
                        cursorX += width;
                    }
                });

                const gain = this.audioCtx.createGain();
                gain.gain.value = Math.floor(volume / 100);
                tracks.push({
                    id: tracks.length + 1,
                    clips,
                    volume,
                    gain,
                });
            }
            this.tracks = tracks;
        },

        copyTraxString() {
            if (!navigator.clipboard) {
                console.warn("Clipboard API not supported");
                return;
            }

            const traxString = this.traxString;

            navigator.clipboard
                .writeText(traxString)
                .then(() => {
                    console.log("Trax string copied to clipboard!");
                })
                .catch((err) => {
                    console.error("Failed to copy trax string:", err);
                });
        },

        displayX(x) {
            return x - this.offset;
        },

        saveSong() {
            window.parent.postMessage({
                'type': 'save-song',
                'string': this.traxString
            }, '*')
        }
    };
}