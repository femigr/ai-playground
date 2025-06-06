// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

// Register Chart.js plugins here
Chart.register(window.chartjsPluginZoom);
// (No plugins are currently registered)


// Global Variables
// Note: resetSelectionBtn related code will be handled by delegation to statsContainer
const DEFAULT_ALTITUDE_COLOR = 'rgb(75, 192, 192)';
const DEFAULT_SPEED_COLOR = 'rgb(255, 99, 132)';
const SELECTED_SEGMENT_COLOR = 'rgb(255, 0, 0)'; // Red for selected segment
const DEFAULT_BORDER_WIDTH = 2; // Default line thickness
const SELECTED_BORDER_WIDTH = 4; // Selected line thickness

let selectedRange = { start: null, end: null };
let rangePolyline = null; // For map highlight of selected range
let throttleTimeoutId = null;
const THROTTLE_DELAY_MS = 150; // (e.g., 150ms)

let isDragging = false;
let dragStartIndex = null;
let dragCurrentIndex = null; // Used for live updates during drag
let currentDraggingChart = null; // To know which chart initiated the drag
let isApplyingProgrammaticZoom = false; // Flag for zoom synchronization

let map;
let altitudeChart;
let speedChart;
let gpxData = { points: [], totalDistance: 0 };
let trackHighlightMarker;
let highlightDebounceTimeout; // For debouncing highlight updates

const gpxFileInput = document.getElementById('gpxFile');
const gpxDataDisplay = document.getElementById('gpxData');

gpxFileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];

    if (file) {
        gpxDataDisplay.innerHTML = `<p>Processing file: ${file.name}...</p>`;
        const reader = new FileReader();

        reader.onload = function(e) {
            const fileContent = e.target.result;
            console.log("File content loaded, length:", fileContent.length);

            try {
                const gpx = new gpxParser();
                gpx.parse(fileContent);

                if (map) {
                    map.remove();
                    map = null;
                }
                if (altitudeChart) {
                    altitudeChart.destroy();
                    altitudeChart = null;
                }
                if (speedChart) {
                    speedChart.destroy();
                    speedChart = null;
                }
                if (trackHighlightMarker) {
                    trackHighlightMarker.remove();
                    trackHighlightMarker = null;
                }

                gpxData = { points: [], totalDistance: 0 };

                if (!gpx.tracks.length || !gpx.tracks[0].points || !gpx.tracks[0].points.length) {
                    gpxDataDisplay.innerHTML = '<p>No track data found in this GPX file.</p>';
                    if (map) { map.remove(); map = null; }
                    if (altitudeChart) { altitudeChart.destroy(); altitudeChart = null; }
                    if (speedChart) { speedChart.destroy(); speedChart = null; }
                    return;
                }
                gpxDataDisplay.innerHTML = '';

                gpxData.points = [];
                let totalDistance = 0;
                const rawPoints = gpx.tracks[0].points;

                for (let i = 0; i < rawPoints.length; i++) {
                    const currentRawPoint = rawPoints[i];
                    let distanceFromPrevious = 0;
                    let currentRawSpeed = 0;

                    if (i > 0) {
                        const prevRawPoint = rawPoints[i-1];
                        const lat1 = parseFloat(prevRawPoint.lat);
                        const lon1 = parseFloat(prevRawPoint.lon);
                        const lat2 = parseFloat(currentRawPoint.lat);
                        const lon2 = parseFloat(currentRawPoint.lon);

                        if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
                             distanceFromPrevious = calculateDistance(lat1, lon1, lat2, lon2);
                        }

                        const currentTime = new Date(currentRawPoint.time).getTime();
                        const prevTime = new Date(prevRawPoint.time).getTime();

                        if (!isNaN(currentTime) && !isNaN(prevTime)) {
                            const timeDiff = (currentTime - prevTime) / 1000;
                            if (timeDiff > 0) {
                                currentRawSpeed = (distanceFromPrevious / timeDiff) * 3.6;
                            }
                        }
                    }
                    totalDistance += distanceFromPrevious;

                    gpxData.points.push({
                        lat: parseFloat(currentRawPoint.lat),
                        lon: parseFloat(currentRawPoint.lon),
                        alt: currentRawPoint.ele !== undefined ? parseFloat(currentRawPoint.ele) : null,
                        time: new Date(currentRawPoint.time),
                        distanceFromStart: totalDistance,
                        rawSpeed: currentRawSpeed,
                        speed: 0
                    });
                }
                gpxData.totalDistance = totalDistance;

                const timeWindowSeconds = 20;
                for (let i = 0; i < gpxData.points.length; i++) {
                    const currentPoint = gpxData.points[i];
                    const currentTimeMs = currentPoint.time.getTime();
                    let sumSpeeds = 0;
                    let countSpeeds = 0;

                    for (let j = i; j >= 0; j--) {
                        const pastPoint = gpxData.points[j];
                        const pastTimeMs = pastPoint.time.getTime();

                        if ((currentTimeMs - pastTimeMs) / 1000 <= timeWindowSeconds) {
                            if (pastPoint.rawSpeed !== null && isFinite(pastPoint.rawSpeed)) {
                                sumSpeeds += pastPoint.rawSpeed;
                                countSpeeds++;
                            }
                        } else {
                            break;
                        }
                    }
                    gpxData.points[i].speed = (countSpeeds > 0) ? (sumSpeeds / countSpeeds) : currentPoint.rawSpeed;
                }

                initMap(gpxData);
                createAltitudeChart(gpxData);
                createSpeedChart(gpxData);
                calculateAndDisplayStats(gpxData);

            } catch (error) {
                console.error("Error parsing GPX file:", error);
                gpxDataDisplay.innerHTML = '<p class="error-message">Error parsing GPX file. Make sure it is a valid GPX.</p>';
            }
        };

        reader.onerror = function(e) {
            console.error("FileReader error:", e);
            gpxDataDisplay.innerHTML = '<p class="error-message">Error reading file.</p>';
        };

        reader.readAsText(file);
    } else {
        gpxDataDisplay.innerHTML = '<p>No file selected. Upload a GPX file to see its data here.</p>';
    }
});

const statsContainerForEvent = document.getElementById('statsContainer');
if (statsContainerForEvent && !statsContainerForEvent._hasResetListener) {
    statsContainerForEvent.addEventListener('click', function(event) {
        if (event.target && event.target.id === 'resetSelectionBtn') {
            selectedRange.start = null;
            selectedRange.end = null;

            if (altitudeChart) {
                updateChartLineStyling(altitudeChart, null);
                isApplyingProgrammaticZoom = true;
                altitudeChart.resetZoom('none');
                isApplyingProgrammaticZoom = false;
            }
            if (speedChart) {
                updateChartLineStyling(speedChart, null);
                isApplyingProgrammaticZoom = true;
                speedChart.resetZoom('none');
                isApplyingProgrammaticZoom = false;
            }

            highlightRangeOnMap(null, null);
            updateHighlight(null);

            isDragging = false;
            dragStartIndex = null;
            dragCurrentIndex = null;
            currentDraggingChart = null;

            if (gpxData && gpxData.points && gpxData.points.length > 0) {
                calculateAndDisplayStats(gpxData);
            } else {
                const statsContainerElem = document.getElementById('statsContainer');
                if (statsContainerElem) {
                    statsContainerElem.innerHTML = '<div id="statsInnerContainer"></div>';
                }
            }
        }
    });
    statsContainerForEvent._hasResetListener = true;
}

function getPointIndexFromEvent(chart, event) {
    const nativeEvent = event.native || event;
    const points = chart.getElementsAtEventForMode(nativeEvent, 'index', { intersect: false }, true);
    if (points && points.length > 0) {
        return points[0].index;
    }
    let canvasPosition;
    if (Chart.helpers && Chart.helpers.getRelativePosition) {
         canvasPosition = Chart.helpers.getRelativePosition(nativeEvent, chart);
    } else {
        const rect = chart.canvas.getBoundingClientRect();
        canvasPosition = {
            x: nativeEvent.clientX - rect.left,
            y: nativeEvent.clientY - rect.top
        };
    }
    const dataX = chart.scales.x.getValueForPixel(canvasPosition.x);
    const index = Math.max(0, Math.min(Math.round(dataX), chart.data.labels.length - 1));
    return index;
}

// Manual drag selection functions are removed. Zoom plugin will handle selection.

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c * 1000;
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function formatDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return "N/A";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDistanceLabel(distanceKm) {
    if (distanceKm >= 100) {
        return Math.round(distanceKm) + 'km';
    } else {
        let formatted = parseFloat(distanceKm.toFixed(1));
        return formatted + 'km';
    }
}

function initMap(gpxData) {
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        return;
    }
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error("Map element not found!");
        return;
    }
    map = L.map('map').setView([gpxData.points[0].lat, gpxData.points[0].lon], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const latLngs = gpxData.points.map(p => [p.lat, p.lon]);
    L.polyline(latLngs, { color: 'blue' }).addTo(map);
    map.fitBounds(latLngs);
    if (trackHighlightMarker) {
        trackHighlightMarker.remove();
    }
    trackHighlightMarker = L.marker([gpxData.points[0].lat, gpxData.points[0].lon], { draggable: false }).addTo(map);
    map.on('mousemove', function(e) {
        if (!gpxData || !gpxData.points || gpxData.points.length === 0) return;
        let closestPointIndex = -1;
        let minDistance = Infinity;
        gpxData.points.forEach((point, index) => {
            const pointLatLng = L.latLng(point.lat, point.lon);
            const distance = e.latlng.distanceTo(pointLatLng);
            if (distance < minDistance) {
                minDistance = distance;
                closestPointIndex = index;
            }
        });
        if (closestPointIndex !== -1) {
            updateHighlight(closestPointIndex);
        }
    });
}

function createAltitudeChart(gpxData) {
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        return;
    }
    const ctx = document.getElementById('altitudeChart').getContext('2d');
    if (!ctx) {
        console.error("Altitude chart canvas context not found!");
        return;
    }
    const labels = gpxData.points.map(p => formatDistanceLabel(p.distanceFromStart / 1000));
    const altitudeData = gpxData.points.map(p => p.alt !== null ? p.alt.toFixed(2) : null);
    if (altitudeChart) {
        altitudeChart.destroy();
    }
    altitudeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Altitude (m)',
                data: altitudeData,
                borderColor: DEFAULT_ALTITUDE_COLOR,
                borderWidth: DEFAULT_BORDER_WIDTH,
                tension: 0.1,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                 x: { title: { display: true, text: 'Distance (km)'}},
                 y: { title: { display: true, text: 'Altitude (m)'}}
            },
            interaction: { mode: 'index', intersect: false },
            onHover: (event, chartElements) => {
                if (!isDragging && chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(155,155,155,0.3)',
                            borderColor: 'rgb(155,155,155)',
                            borderWidth: 1
                        },
                        mode: 'x',
                        onZoomComplete: function({chart}) {
                            if (isApplyingProgrammaticZoom) {
                                console.log(`[Zoom] onZoomComplete on ${chart.canvas.id} skipped due to programmatic zoom.`);
                                return;
                            }

                            const { min: newXMin, max: newXMax } = chart.scales.x;
                            const allLabels = chart.data.labels;

                            let startIndex = Math.max(0, Math.floor(newXMin));
                            let endIndex = Math.min(allLabels.length - 1, Math.ceil(newXMax));

                            if (startIndex < 0) startIndex = 0;
                            if (endIndex >= allLabels.length) endIndex = allLabels.length - 1;

                            if (startIndex > endIndex) {
                                console.log(`[Zoom] onZoomComplete on ${chart.canvas.id} resulted in invalid index range (${startIndex}-${endIndex}). Resetting view.`);
                                selectedRange.start = null;
                                selectedRange.end = null;
                                highlightRangeOnMap(null, null);
                                calculateAndDisplayStats(gpxData);
                                updateChartLineStyling(chart, null); // Reset current chart's line style

                                const otherChartToReset = (chart === altitudeChart) ? speedChart : altitudeChart;
                                if (otherChartToReset) {
                                    console.log(`[Zoom] Programmatically resetting zoom on ${otherChartToReset.canvas.id}.`);
                                    isApplyingProgrammaticZoom = true;
                                    otherChartToReset.resetZoom('none');
                                    updateChartLineStyling(otherChartToReset, null); // Reset other chart's line style
                                    isApplyingProgrammaticZoom = false;
                                }
                                return;
                            }

                            selectedRange.start = startIndex;
                            selectedRange.end = endIndex;
                            console.log(`[Zoom] Zoom complete on ${chart.canvas.id}. Range Indices: ${startIndex}-${endIndex}. Applying to map/stats.`);

                            highlightRangeOnMap(selectedRange.start, selectedRange.end);
                            calculateAndDisplayStats(gpxData, selectedRange.start, selectedRange.end);
                            updateChartLineStyling(chart, selectedRange); // Update current chart's line style

                            const otherChartToSync = (chart === altitudeChart) ? speedChart : altitudeChart;
                            if (otherChartToSync) {
                                console.log(`[Zoom] Programmatically zooming ${otherChartToSync.canvas.id} to match range: ${newXMin}-${newXMax}.`);
                                isApplyingProgrammaticZoom = true;
                                otherChartToSync.zoomScale('x', { min: newXMin, max: newXMax }, 'none');
                                updateChartLineStyling(otherChartToSync, selectedRange); // Sync other chart's line style
                                isApplyingProgrammaticZoom = false;
                            }
                        }
                    }
                }
            }
        }
    });
    // altitudeChart.myDefaultColor = DEFAULT_ALTITUDE_COLOR; // This line is removed as per instructions
}

function createSpeedChart(gpxData) {
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        return;
    }
    const ctx = document.getElementById('speedChart').getContext('2d');
    if (!ctx) {
        console.error("Speed chart canvas context not found!");
        return;
    }
    const labels = gpxData.points.map(p => formatDistanceLabel(p.distanceFromStart / 1000));
    const speedData = gpxData.points.map(p => (p.speed !== null && isFinite(p.speed)) ? p.speed.toFixed(2) : null);
    if (speedChart) {
        speedChart.destroy();
    }
    speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Smoothed Speed (km/h, 20s avg)',
                data: speedData,
                borderColor: DEFAULT_SPEED_COLOR,
                borderWidth: DEFAULT_BORDER_WIDTH,
                tension: 0.1,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { /* ... */ },
            interaction: { mode: 'index', intersect: false, },
            onHover: (event, chartElements) => {
                 if (!isDragging && chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(155,155,155,0.3)',
                            borderColor: 'rgb(155,155,155)',
                            borderWidth: 1
                        },
                        mode: 'x',
                        onZoomComplete: function({chart}) {
                            if (isApplyingProgrammaticZoom) {
                                console.log(`[Zoom] onZoomComplete on ${chart.canvas.id} skipped due to programmatic zoom.`);
                                return;
                            }

                            const { min: newXMin, max: newXMax } = chart.scales.x;
                            const allLabels = chart.data.labels;

                            let startIndex = Math.max(0, Math.floor(newXMin));
                            let endIndex = Math.min(allLabels.length - 1, Math.ceil(newXMax));

                            if (startIndex < 0) startIndex = 0;
                            if (endIndex >= allLabels.length) endIndex = allLabels.length - 1;

                            if (startIndex > endIndex) {
                                console.log(`[Zoom] onZoomComplete on ${chart.canvas.id} resulted in invalid index range (${startIndex}-${endIndex}). Resetting view.`);
                                selectedRange.start = null;
                                selectedRange.end = null;
                                highlightRangeOnMap(null, null);
                                calculateAndDisplayStats(gpxData);
                                updateChartLineStyling(chart, null);

                                const otherChartToReset = (chart === altitudeChart) ? speedChart : altitudeChart;
                                if (otherChartToReset) {
                                    console.log(`[Zoom] Programmatically resetting zoom on ${otherChartToReset.canvas.id}.`);
                                    isApplyingProgrammaticZoom = true;
                                    otherChartToReset.resetZoom('none');
                                    updateChartLineStyling(otherChartToReset, null);
                                    isApplyingProgrammaticZoom = false;
                                }
                                return;
                            }

                            selectedRange.start = startIndex;
                            selectedRange.end = endIndex;
                            console.log(`[Zoom] Zoom complete on ${chart.canvas.id}. Range Indices: ${startIndex}-${endIndex}. Applying to map/stats.`);

                            highlightRangeOnMap(selectedRange.start, selectedRange.end);
                            calculateAndDisplayStats(gpxData, selectedRange.start, selectedRange.end);
                            updateChartLineStyling(chart, selectedRange);

                            const otherChartToSync = (chart === altitudeChart) ? speedChart : altitudeChart;
                            if (otherChartToSync) {
                                console.log(`[Zoom] Programmatically zooming ${otherChartToSync.canvas.id} to match range: ${newXMin}-${newXMax}.`);
                                isApplyingProgrammaticZoom = true;
                                otherChartToSync.zoomScale('x', { min: newXMin, max: newXMax }, 'none');
                                updateChartLineStyling(otherChartToSync, selectedRange);
                                isApplyingProgrammaticZoom = false;
                            }
                        }
                    }
                }
            }
        }
    });
    // speedChart.myDefaultColor = DEFAULT_SPEED_COLOR; // This line is removed
}

function updateChartLineStyling(chart, currentRange) {
    // console.log(`[Styling Debug] updateChartLineStyling FOR CHART: ${chart.canvas.id}, CALLED WITH RANGE:`, currentRange);

    if (!chart || !chart.data || !chart.data.datasets || chart.data.datasets.length === 0) {
        // console.warn('[Styling Debug] Chart or dataset not found for styling in updateChartLineStyling.');
        return;
    }

    const dataset = chart.data.datasets[0];
    const defaultColorFromChart = chart.myDefaultColor || (chart.canvas.id === 'altitudeChart' ? DEFAULT_ALTITUDE_COLOR : DEFAULT_SPEED_COLOR); // Fallback if myDefaultColor is not set
    const numDataPoints = chart.data.datasets[0].data.length;

    if (currentRange && currentRange.start !== null && currentRange.end !== null && currentRange.start <= currentRange.end && numDataPoints > 0) {
        const startIndex = currentRange.start;
        const endIndex = currentRange.end;
        // console.log(`[Styling Debug] APPLYING ARRAY styles for range: ${startIndex}-${endIndex} on chart: ${chart.canvas.id}`);

        const newBorderColors = new Array(numDataPoints);
        const newBorderWidths = new Array(numDataPoints);

        for (let i = 0; i < numDataPoints; i++) {
            const inRange = (i >= startIndex && i <= endIndex);
            newBorderColors[i] = inRange ? SELECTED_SEGMENT_COLOR : defaultColorFromChart;
            newBorderWidths[i] = inRange ? SELECTED_BORDER_WIDTH : DEFAULT_BORDER_WIDTH;
            // console.log(`[Styling Debug] Array Gen - Chart: ${chart.canvas.id}, Idx: ${i}, Range: ${startIndex}-${endIndex}, InRange: ${inRange}, Color: ${newBorderColors[i]}, Width: ${newBorderWidths[i]}`);
        }
        dataset.borderColor = newBorderColors;
        dataset.borderWidth = newBorderWidths;

    } else {
        // console.log(`[Styling Debug] RESETTING styles to default (static values) on chart: ${chart.canvas.id}`);
        dataset.borderColor = defaultColorFromChart;
        dataset.borderWidth = DEFAULT_BORDER_WIDTH;
    }
    chart.update();
}

function updateHighlight(index) {
    clearTimeout(highlightDebounceTimeout);

    if (index === null || index === undefined || index < 0 || (gpxData && gpxData.points && index >= gpxData.points.length)) {
        highlightDebounceTimeout = setTimeout(() => {
            if (map && trackHighlightMarker && map.hasLayer(trackHighlightMarker)) {
                trackHighlightMarker.remove();
            }
            if (altitudeChart) {
                altitudeChart.setActiveElements([], { x: 0, y: 0 });
                altitudeChart.update('none');
            }
            if (speedChart) {
                speedChart.setActiveElements([], { x: 0, y: 0 });
                speedChart.update('none');
            }
        }, 10);
        return;
    }

    highlightDebounceTimeout = setTimeout(() => {
        if (!gpxData || !gpxData.points || !gpxData.points[index]) {
            return;
        }
        const point = gpxData.points[index];

        if (map && trackHighlightMarker) {
            trackHighlightMarker.setLatLng([point.lat, point.lon]);
            if (!map.hasLayer(trackHighlightMarker)) {
                trackHighlightMarker.addTo(map);
            }
        } else if (map && !trackHighlightMarker && gpxData.points[0]) {
            trackHighlightMarker = L.marker([gpxData.points[0].lat, gpxData.points[0].lon], { draggable: false });
            trackHighlightMarker.setLatLng([point.lat, point.lon]).addTo(map);
        }

        if (altitudeChart) {
            if (altitudeChart.data && altitudeChart.data.datasets[0] && altitudeChart.data.datasets[0].data[index] !== undefined) {
                 if (!altitudeChart.getActiveElements() || altitudeChart.getActiveElements().length === 0 || altitudeChart.getActiveElements()[0].index !== index) {
                    altitudeChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    altitudeChart.update('none');
                }
            }
        }

        if (speedChart) {
            if (speedChart.data && speedChart.data.datasets[0] && speedChart.data.datasets[0].data[index] !== undefined) {
                if (!speedChart.getActiveElements() || speedChart.getActiveElements().length === 0 || speedChart.getActiveElements()[0].index !== index) {
                    speedChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    speedChart.update('none');
                }
            }
        }
    }, 10);
}


function highlightRangeOnMap(startIndex, endIndex) {
    if (!map) return;

    if (rangePolyline) {
        rangePolyline.remove();
        rangePolyline = null;
    }

    if (gpxData && gpxData.points && gpxData.points.length > 0 && startIndex !== null && endIndex !== null && startIndex <= endIndex && startIndex >= 0 && endIndex < gpxData.points.length) {
        const selectedPoints = gpxData.points.slice(startIndex, endIndex + 1);
        const latLngs = selectedPoints.map(p => [p.lat, p.lon]);

        if (latLngs.length > 1) {
            rangePolyline = L.polyline(latLngs, {
                color: 'red',
                weight: 5,
                opacity: 0.7
            }).addTo(map);
        }
    } else {
        // console.log("Invalid range or no range selected, clearing map highlight.");
    }
}

function calculateAndDisplayStats(fullGpxData, startIndex, endIndex) {
    const statsContainer = document.getElementById('statsContainer');
    if (!statsContainer) {
        console.error("Stats container not found!");
        return;
    }

    let pointsToProcess = fullGpxData.points;
    if (startIndex !== undefined && endIndex !== undefined && startIndex !== null && endIndex !== null && startIndex <= endIndex && startIndex >= 0 && endIndex < fullGpxData.points.length) {
        pointsToProcess = fullGpxData.points.slice(startIndex, endIndex + 1);
    }

    if (!pointsToProcess || pointsToProcess.length === 0) {
        statsContainer.innerHTML = '<div id="statsInnerContainer"><span class="stat-item">No data for selected range.</span></div>';
        return;
    }

    let rangeTotalDistanceMeters = 0;
    if (pointsToProcess.length > 1) {
        const firstPointInRange = pointsToProcess[0];
        const lastPointInRange = pointsToProcess[pointsToProcess.length - 1];
        rangeTotalDistanceMeters = lastPointInRange.distanceFromStart - firstPointInRange.distanceFromStart;
    } else if (pointsToProcess.length === 1) {
        rangeTotalDistanceMeters = 0;
    }

    let totalTimeInSeconds = 0;
    if (pointsToProcess.length > 1) {
        const firstPointTime = pointsToProcess[0].time.getTime();
        const lastPointTime = pointsToProcess[pointsToProcess.length - 1].time.getTime();
        totalTimeInSeconds = (lastPointTime - firstPointTime) / 1000;
    }

    let calculatedAverageSpeedKmh = 0;
    if (totalTimeInSeconds > 0 && rangeTotalDistanceMeters > 0) {
        calculatedAverageSpeedKmh = (rangeTotalDistanceMeters / totalTimeInSeconds) * 3.6;
    } else if (rangeTotalDistanceMeters === 0 && totalTimeInSeconds === 0 && pointsToProcess.length ===1){
        calculatedAverageSpeedKmh = 0;
    }

    let calculatedTotalAscent = 0;
    if (pointsToProcess.length > 0) {
        for (let i = 1; i < pointsToProcess.length; i++) {
            const prevPoint = pointsToProcess[i-1];
            const currentPoint = pointsToProcess[i];
            if (prevPoint.alt !== null && currentPoint.alt !== null && !isNaN(prevPoint.alt) && !isNaN(currentPoint.alt)) {
                if (currentPoint.alt > prevPoint.alt) {
                    calculatedTotalAscent += currentPoint.alt - prevPoint.alt;
                }
            }
        }
    }

    let calculatedMaxSpeedKmh = 0;
    if (pointsToProcess.length > 0) {
        pointsToProcess.forEach(point => {
            if (point.speed !== null && !isNaN(point.speed) && point.speed > calculatedMaxSpeedKmh) {
                calculatedMaxSpeedKmh = point.speed;
            }
        });
         if (pointsToProcess.length === 1 && pointsToProcess[0].speed !== null && !isNaN(pointsToProcess[0].speed)){
            calculatedMaxSpeedKmh = pointsToProcess[0].speed;
        }
    }

    const statsData = [
        { label: "Dist:", value: `${(rangeTotalDistanceMeters / 1000).toFixed(2)} km` },
        { label: "Time:", value: formatDuration(totalTimeInSeconds) },
        { label: "Avg Spd:", value: `${calculatedAverageSpeedKmh.toFixed(1)} km/h` },
        { label: "Asc:", value: `${Math.round(calculatedTotalAscent)} m` },
        { label: "Max Spd:", value: `${calculatedMaxSpeedKmh.toFixed(1)} km/h` }
    ];

    let statsHTML = '<div id="statsInnerContainer">';
    statsData.forEach(stat => {
        statsHTML += `<span class="stat-item"><strong>${stat.label}</strong> ${stat.value}</span>`;
    });
    statsHTML += `<button id="resetSelectionBtn" class="stat-item stat-button">Reset</button>`;
    statsHTML += '</div>';

    statsContainer.innerHTML = statsHTML;
}

[end of script.js]
