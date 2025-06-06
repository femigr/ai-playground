// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

// Register Chart.js plugins here
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

                // Clear previous map and charts
                if (map) {
                    map.remove();
                    map = null; // Ensure it's reset for next file
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


                gpxData = { points: [], totalDistance: 0 }; // Reset gpxData

                // ---> Start of new section to replace existing point processing <---
                if (!gpx.tracks.length || !gpx.tracks[0].points || !gpx.tracks[0].points.length) {
                    gpxDataDisplay.innerHTML = '<p>No track data found in this GPX file.</p>';
                    if (map) { map.remove(); map = null; }
                    if (altitudeChart) { altitudeChart.destroy(); altitudeChart = null; }
                    if (speedChart) { speedChart.destroy(); speedChart = null; }
                    return;
                }
                gpxDataDisplay.innerHTML = ''; // Clear display for map/charts

                gpxData.points = []; // Initialize points array
                let totalDistance = 0;
                const rawPoints = gpx.tracks[0].points;

                for (let i = 0; i < rawPoints.length; i++) {
                    const currentRawPoint = rawPoints[i];
                    let distanceFromPrevious = 0;
                    let currentRawSpeed = 0; // Store as raw speed

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
                            const timeDiff = (currentTime - prevTime) / 1000; // seconds
                            if (timeDiff > 0) {
                                currentRawSpeed = (distanceFromPrevious / timeDiff) * 3.6; // m/s to km/h
                            }
                        }
                    }
                    totalDistance += distanceFromPrevious;

                    gpxData.points.push({
                        lat: parseFloat(currentRawPoint.lat),
                        lon: parseFloat(currentRawPoint.lon),
                        alt: currentRawPoint.ele !== undefined ? parseFloat(currentRawPoint.ele) : null,
                        time: new Date(currentRawPoint.time), // Keep as Date object
                        distanceFromStart: totalDistance,
                        rawSpeed: currentRawSpeed, // Store raw speed
                        speed: 0 // Placeholder for smoothed speed
                    });
                }
                gpxData.totalDistance = totalDistance;

                // Second pass: Calculate smoothed speed (20-second floating average)
                const timeWindowSeconds = 20;
                for (let i = 0; i < gpxData.points.length; i++) {
                    const currentPoint = gpxData.points[i];
                    const currentTimeMs = currentPoint.time.getTime();
                    let sumSpeeds = 0;
                    let countSpeeds = 0;

                    // Look backwards for points within the time window
                    for (let j = i; j >= 0; j--) {
                        const pastPoint = gpxData.points[j];
                        const pastTimeMs = pastPoint.time.getTime();

                        if ((currentTimeMs - pastTimeMs) / 1000 <= timeWindowSeconds) {
                            if (pastPoint.rawSpeed !== null && isFinite(pastPoint.rawSpeed)) {
                                sumSpeeds += pastPoint.rawSpeed;
                                countSpeeds++;
                            }
                        } else {
                            break; // Points are too old, stop searching
                        }
                    }
                    gpxData.points[i].speed = (countSpeeds > 0) ? (sumSpeeds / countSpeeds) : currentPoint.rawSpeed; // Use raw if no window
                }
                // ---> End of new section <---

                // Call functions to initialize map and charts
                initMap(gpxData);
                createAltitudeChart(gpxData);
                createSpeedChart(gpxData);
                calculateAndDisplayStats(gpxData); // Display stats after processing

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

// const resetSelectionBtn = document.getElementById('resetSelectionBtn'); // This direct listener is removed
// if(resetSelectionBtn) { // This direct listener is removed
    // resetSelectionBtn.addEventListener('click', function() { // This direct listener is removed
        // selectedRange.start = null; // This direct listener is removed
        // selectedRange.end = null; // This direct listener is removed
// This direct listener is removed
        // if (altitudeChart) updateChartLineStyling(altitudeChart, null); // This direct listener is removed
        // if (speedChart) updateChartLineStyling(speedChart, null); // This direct listener is removed
// This direct listener is removed
        // highlightRangeOnMap(null, null); // Clears the red polyline // This direct listener is removed
// This direct listener is removed
        // if (gpxData && gpxData.points && gpxData.points.length > 0) { // This direct listener is removed
            // calculateAndDisplayStats(gpxData); // This direct listener is removed
        // } else { // This direct listener is removed
            // const statsContainer = document.getElementById('statsContainer'); // This direct listener is removed
            // if (statsContainer) { // This direct listener is removed
                // statsContainer.innerHTML = '<div id="statsInnerContainer"></div>'; // This direct listener is removed
            // } // This direct listener is removed
        // } // This direct listener is removed
// This direct listener is removed
        // updateHighlight(null); // Hides map marker & clears chart point highlights // This direct listener is removed
// This direct listener is removed
        // isDragging = false; // This direct listener is removed
        // dragStartIndex = null; // This direct listener is removed
        // dragCurrentIndex = null; // This direct listener is removed
        // currentDraggingChart = null; // This direct listener is removed
// This direct listener is removed
        // console.log("Selection has been reset."); // This direct listener is removed
    // }); // This direct listener is removed
// } // This direct listener is removed

const statsContainerForEvent = document.getElementById('statsContainer');
if (statsContainerForEvent && !statsContainerForEvent._hasResetListener) { // Use a flag to ensure it's added only once
    statsContainerForEvent.addEventListener('click', function(event) {
        if (event.target && event.target.id === 'resetSelectionBtn') {
            // console.log("Reset Selection button clicked (delegated)."); // Removed
            selectedRange.start = null;
            selectedRange.end = null;

            if (altitudeChart) updateChartLineStyling(altitudeChart, null);
            if (speedChart) updateChartLineStyling(speedChart, null);

            highlightRangeOnMap(null, null);
            updateHighlight(null); // Hide map marker

            // Reset drag state variables
            isDragging = false;
            dragStartIndex = null;
            dragCurrentIndex = null;
            currentDraggingChart = null;

            // Recalculate stats for the entire track.
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
    statsContainerForEvent._hasResetListener = true; // Set the flag
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

function handleChartMouseDown(event) {
    const chart = event.chart;
    // console.log('[Event] handleChartMouseDown: Clearing style on otherChart', (chart === altitudeChart ? speedChart : altitudeChart) ? (chart === altitudeChart ? speedChart.canvas.id : altitudeChart.canvas.id) : 'N/A'); // Removed
    const otherChart = (chart === altitudeChart) ? speedChart : altitudeChart;
    if (otherChart) updateChartLineStyling(otherChart, null);

    isDragging = true;
    currentDraggingChart = chart;
    dragStartIndex = getPointIndexFromEvent(chart, event.originalEvent || event);
    dragCurrentIndex = dragStartIndex;

    // console.log('[Event] handleChartMouseDown: Styling initial point on currentDraggingChart', currentDraggingChart ? currentDraggingChart.canvas.id : 'N/A', { start: dragStartIndex, end: dragStartIndex }); // Removed
    updateChartLineStyling(chart, { start: dragStartIndex, end: dragStartIndex });

    updateHighlight(dragStartIndex);
}

function handleChartMouseMove(event) {
    const chart = event.chart;
    const currentHoverIndex = getPointIndexFromEvent(chart, event.originalEvent || event);

    if (isDragging && chart === currentDraggingChart) {
        dragCurrentIndex = currentHoverIndex;

        if (throttleTimeoutId) clearTimeout(throttleTimeoutId);
        throttleTimeoutId = setTimeout(() => {
            if (!isDragging) return;
            const tempMin = Math.min(dragStartIndex, dragCurrentIndex);
            const tempMax = Math.max(dragStartIndex, dragCurrentIndex);
            const otherChart = (currentDraggingChart === altitudeChart) ? speedChart : altitudeChart;

            // console.log('[Event] handleChartMouseMove (throttled): Updating style. currentDraggingChart:', currentDraggingChart ? currentDraggingChart.canvas.id : 'N/A', 'Other chart:', otherChart ? otherChart.canvas.id : 'N/A', 'Range:', { start: tempMin, end: tempMax }); // Removed
            updateChartLineStyling(currentDraggingChart, { start: tempMin, end: tempMax });
            if (otherChart) updateChartLineStyling(otherChart, { start: tempMin, end: tempMax });

            highlightRangeOnMap(tempMin, tempMax);
            calculateAndDisplayStats(gpxData, tempMin, tempMax);
            updateHighlight(dragCurrentIndex);
        }, THROTTLE_DELAY_MS);
    } else if (!isDragging) {
        // updateHighlight(currentHoverIndex);
    }
}

function handleChartMouseUp(eventInfo) {
    if (!isDragging || !currentDraggingChart) {
        isDragging = false;
        return;
    }

    const chart = currentDraggingChart;

    selectedRange.start = Math.min(dragStartIndex, dragCurrentIndex);
    selectedRange.end = Math.max(dragStartIndex, dragCurrentIndex);

    isDragging = false;
    const otherChart = (chart === altitudeChart) ? speedChart : altitudeChart;
    // console.log('[Event] handleChartMouseUp: Finalizing style. Chart:', chart ? chart.canvas.id : 'N/A', 'Other chart:', otherChart ? otherChart.canvas.id : 'N/A', 'SelectedRange:', selectedRange); // Removed

    updateChartLineStyling(chart, selectedRange);
    if (otherChart) updateChartLineStyling(otherChart, selectedRange);

    highlightRangeOnMap(selectedRange.start, selectedRange.end);
    calculateAndDisplayStats(gpxData, selectedRange.start, selectedRange.end);
    updateHighlight(dragCurrentIndex);

    // console.log(`Selection finalized on ${chart.canvas.id}: ${selectedRange.start} to ${selectedRange.end}`); // Kept for now, useful

    dragStartIndex = null;
    dragCurrentIndex = null;
    currentDraggingChart = null;
}

function handleChartMouseLeave(event) {
    const chart = event.chart;
    if (isDragging && chart === currentDraggingChart) {
        // console.log("Mouse left chart canvas while dragging."); // Removed
    }
}

document.onmouseup = (e) => {
  if (isDragging && currentDraggingChart) {
    handleChartMouseUp({ chart: currentDraggingChart, originalEvent: e });
  }
};


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
    // console.log("Initializing map with data:", gpxData); // Kept for now
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        // console.log("No points to display on map."); // Kept for now
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
    // console.log("Creating altitude chart with data:", gpxData); // Kept
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        // console.log("No points for altitude chart."); // Kept
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
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Altitude (m)'
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => {
                if (!isDragging && chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
            }
        }
    });

    altitudeChart.canvas.onmousedown = (e) => handleChartMouseDown({ originalEvent: e, chart: altitudeChart });
    altitudeChart.canvas.onmousemove = (e) => handleChartMouseMove({ originalEvent: e, chart: altitudeChart });
    altitudeChart.canvas.onmouseout = (e) => handleChartMouseLeave({ originalEvent: e, chart: altitudeChart });
    altitudeChart.myDefaultColor = DEFAULT_ALTITUDE_COLOR;
}

function createSpeedChart(gpxData) {
    // console.log("Creating speed chart with data:", gpxData); // Kept
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        // console.log("No points for speed chart."); // Kept
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
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Speed (km/h)'
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => {
                 if (!isDragging && chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
            }
        }
    });

    speedChart.canvas.onmousedown = (e) => handleChartMouseDown({ originalEvent: e, chart: speedChart });
    speedChart.canvas.onmousemove = (e) => handleChartMouseMove({ originalEvent: e, chart: speedChart });
    speedChart.canvas.onmouseout = (e) => handleChartMouseLeave({ originalEvent: e, chart: speedChart });
    speedChart.myDefaultColor = DEFAULT_SPEED_COLOR;
}

function updateChartLineStyling(chart, currentRange) {
    // console.log(`[Styling] updateChartLineStyling called for chart: ${chart.canvas.id}, range:`, currentRange);

    if (!chart || !chart.data || !chart.data.datasets || chart.data.datasets.length === 0) {
        // console.warn('[Styling] Chart or dataset not found for styling.'); // Removed
        return;
    }

    const dataset = chart.data.datasets[0];
    const defaultColor = chart.myDefaultColor || (chart.canvas.id === 'altitudeChart' ? DEFAULT_ALTITUDE_COLOR : DEFAULT_SPEED_COLOR);

    if (currentRange && currentRange.start !== null && currentRange.end !== null && currentRange.start <= currentRange.end) {
        const startIndex = currentRange.start;
        const endIndex = currentRange.end;
        // console.log(`[Styling] Applying selected style. Range: ${startIndex}-${endIndex} for ${chart.canvas.id}`); // Removed

        dataset.borderColor = function(context) {
            const index = context.dataIndex;
            const inRange = index >= startIndex && index <= endIndex;
            const color = inRange ? SELECTED_SEGMENT_COLOR : defaultColor;
            // console.log(`[Styling] borderColor for ${chart.canvas.id} - Idx: ${index}, Range: ${startIndex}-${endIndex}, InRange: ${inRange}, Color: ${color}`);
            return color;
        };
        dataset.borderWidth = function(context) {
            const index = context.dataIndex;
            const inRange = index >= startIndex && index <= endIndex;
            const width = inRange ? SELECTED_BORDER_WIDTH : DEFAULT_BORDER_WIDTH;
            // console.log(`[Styling] borderWidth for ${chart.canvas.id} - Idx: ${index}, Range: ${startIndex}-${endIndex}, InRange: ${inRange}, Width: ${width}`);
            return width;
        };
    } else {
        // console.log(`[Styling] Resetting to default style for ${chart.canvas.id}`); // Removed
        dataset.borderColor = defaultColor;
        dataset.borderWidth = DEFAULT_BORDER_WIDTH;
    }
    chart.update();      // Use default update mode
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
        // console.log("Invalid range or no range selected, clearing map highlight."); // Kept for now
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
        // console.log(`Calculating stats for range: ${startIndex} - ${endIndex}, ${pointsToProcess.length} points`); // Kept
    } else {
        // console.log("Calculating stats for full track."); // Kept
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
