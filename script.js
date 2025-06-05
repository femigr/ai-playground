// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

// Register Chart.js plugins here
// if (window.chartjsPluginZoom) {
//     Chart.register(window.chartjsPluginZoom);
//     console.log("chartjs-plugin-zoom registered.");
// } else {
//     console.error("chartjs-plugin-zoom not found. Ensure it's loaded before script.js");
// }
if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
    console.log("chartjs-plugin-annotation registered.");
} else {
    console.error("chartjs-plugin-annotation not found. Ensure it's loaded before script.js");
}


// Global Variables
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

const resetSelectionBtn = document.getElementById('resetSelectionBtn');
if(resetSelectionBtn) {
    resetSelectionBtn.addEventListener('click', function() {
        selectedRange.start = null;
        selectedRange.end = null;

        if (altitudeChart) {
            updateSelectionAnnotation(altitudeChart, null, null);
        }
        if (speedChart) {
            updateSelectionAnnotation(speedChart, null, null);
        }

        highlightRangeOnMap(null, null); // Clears the red polyline

        if (gpxData && gpxData.points && gpxData.points.length > 0) {
            calculateAndDisplayStats(gpxData);
        } else {
            const statsContainer = document.getElementById('statsContainer');
            if (statsContainer) {
                statsContainer.innerHTML = '<div id="statsInnerContainer"></div>';
            }
        }

        updateHighlight(null); // Hides map marker & clears chart point highlights

        isDragging = false;
        dragStartIndex = null;
        dragCurrentIndex = null;
        currentDraggingChart = null;

        console.log("Selection has been reset.");
    });
}

// Add new mouse event handling functions here, before createAltitudeChart

function getPointIndexFromEvent(chart, event) {
    // Chart.js v4 uses event.native for the original DOM event, if applicable
    const nativeEvent = event.native || event;
    const points = chart.getElementsAtEventForMode(nativeEvent, 'index', { intersect: false }, true);
    if (points && points.length > 0) {
        return points[0].index;
    }
    // Fallback for Chart.helpers.getRelativePosition (Chart.js v3 way)
    // For v4, we might need to ensure Chart.helpers is available or use a direct canvas offset calculation.
    // Assuming Chart.helpers.getRelativePosition is available or polyfilled for simplicity here.
    // If not, this part would need adjustment for pure v4.
    let canvasPosition;
    if (Chart.helpers && Chart.helpers.getRelativePosition) {
         canvasPosition = Chart.helpers.getRelativePosition(nativeEvent, chart);
    } else { // Basic fallback for canvas relative position
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


function updateSelectionAnnotation(chart, startIndex, endIndex) {
    if (!chart) return;

    const annotations = {}; // Start with an empty object for annotations

    if (startIndex !== null && endIndex !== null && startIndex >= 0 && endIndex >= 0 && chart.data && chart.data.labels) {
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);

        annotations.selectionBox = {
            type: 'box',
            xMin: minIndex,
            xMax: maxIndex,
            backgroundColor: 'rgba(0, 102, 255, 0.2)',
            borderColor: 'rgba(0, 102, 255, 0.5)',
            borderWidth: 1
        };
        // Grey out areas outside selection
        if (minIndex > 0) { // only add if there's space to the left
            annotations.greyOutLeft = {
                type: 'box',
                xMin: 0,
                xMax: minIndex,
                backgroundColor: 'rgba(128, 128, 128, 0.3)',
                borderColor: 'rgba(128, 128, 128, 0.0)',
                borderWidth: 0
            };
        }
        if (maxIndex < chart.data.labels.length - 1) { // only add if there's space to the right
             annotations.greyOutRight = {
                type: 'box',
                xMin: maxIndex,
                xMax: chart.data.labels.length - 1,
                backgroundColor: 'rgba(128, 128, 128, 0.3)',
                borderColor: 'rgba(128, 128, 128, 0.0)',
                borderWidth: 0
            };
        }
    }
    // This replaces all existing annotations.
    chart.options.plugins.annotation.annotations = annotations;
    chart.update('none'); // 'none' for no animation
}


function handleChartMouseDown(event) {
    const chart = event.chart; // The chart instance is passed in our wrapper
    isDragging = true;
    currentDraggingChart = chart;
    dragStartIndex = getPointIndexFromEvent(chart, event.originalEvent || event); // event.originalEvent if we wrapped it
    dragCurrentIndex = dragStartIndex;

    updateSelectionAnnotation(chart, dragStartIndex, dragCurrentIndex);
    updateHighlight(dragStartIndex); // Map marker

    // Clear selection on the other chart
    const otherChart = (chart === altitudeChart) ? speedChart : altitudeChart;
    if (otherChart) {
        updateSelectionAnnotation(otherChart, null, null);
    }
}

function handleChartMouseMove(event) {
    const chart = event.chart;
    const currentHoverIndex = getPointIndexFromEvent(chart, event.originalEvent || event);

    if (isDragging && chart === currentDraggingChart) {
        dragCurrentIndex = currentHoverIndex;
        updateSelectionAnnotation(chart, dragStartIndex, dragCurrentIndex);

        if (throttleTimeoutId) clearTimeout(throttleTimeoutId);
        throttleTimeoutId = setTimeout(() => {
            if (!isDragging) return; // Check if drag was cancelled before timeout runs
            const tempMin = Math.min(dragStartIndex, dragCurrentIndex);
            const tempMax = Math.max(dragStartIndex, dragCurrentIndex);

            highlightRangeOnMap(tempMin, tempMax);
            calculateAndDisplayStats(gpxData, tempMin, tempMax);
            updateHighlight(dragCurrentIndex);
        }, THROTTLE_DELAY_MS);
    } else if (!isDragging) {
        // updateHighlight(currentHoverIndex); // Already handled by chart's onHover
    }
}

function handleChartMouseUp(eventInfo) { // eventInfo is { chart, originalEvent }
    if (!isDragging || !currentDraggingChart) {
        isDragging = false; // Reset just in case
        return;
    }

    // Use currentDraggingChart as it's the one where dragging started.
    // dragCurrentIndex should be up-to-date from the last mousemove on that chart's canvas,
    // or if mouseup is outside, it's the last known dragCurrentIndex.
    // If originalEvent is on a different chart, getPointIndexFromEvent might be misleading here.
    // So, we rely on dragCurrentIndex already being set.

    selectedRange.start = Math.min(dragStartIndex, dragCurrentIndex);
    selectedRange.end = Math.max(dragStartIndex, dragCurrentIndex);

    isDragging = false;
    // currentDraggingChart will be reset after updates

    // Final update for the chart that was dragged on
    updateSelectionAnnotation(currentDraggingChart, selectedRange.start, selectedRange.end);

    const otherChart = (currentDraggingChart === altitudeChart) ? speedChart : altitudeChart;
    if (otherChart) {
        updateSelectionAnnotation(otherChart, selectedRange.start, selectedRange.end);
    }

    highlightRangeOnMap(selectedRange.start, selectedRange.end);
    calculateAndDisplayStats(gpxData, selectedRange.start, selectedRange.end);
    updateHighlight(dragCurrentIndex);

    console.log(`Selection finalized on ${currentDraggingChart.canvas.id}: ${selectedRange.start} to ${selectedRange.end}`);

    dragStartIndex = null;
    dragCurrentIndex = null;
    currentDraggingChart = null; // Important to reset
}

function handleChartMouseLeave(event) {
    const chart = event.chart;
    if (isDragging && chart === currentDraggingChart) {
        // Don't finalize selection here, wait for global mouseup.
        // console.log("Mouse left chart canvas while dragging.");
        // If we wanted to cancel on mouse leave:
        // updateSelectionAnnotation(chart, null, null);
        // ... and reset all states ...
    }
}

document.onmouseup = (e) => { // Global mouseup listener
  if (isDragging && currentDraggingChart) {
    // Need to determine dragCurrentIndex if mouse is outside the original chart
    // This is tricky. For now, we assume dragCurrentIndex was set by the last mousemove
    // within a chart canvas. If mouseup is far away, dragCurrentIndex might not be what user expects.
    // A more complex solution would involve tracking mouse position globally.
    // For this iteration, we'll use the last known dragCurrentIndex.
    handleChartMouseUp({ chart: currentDraggingChart, originalEvent: e });
  }
};


function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c * 1000; // Distance in meters
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
        // Use toFixed(1) for one decimal place, then parseFloat to remove trailing .0 if any
        let formatted = parseFloat(distanceKm.toFixed(1));
        // Ensure that numbers like 1.0 are displayed as "1km" not "1.0km" if that's desired,
        // or always show one decimal place if < 100km.
        // The user request "1.2345km should be 1.2km" implies toFixed(1) is good.
        // "112.3452km should be 112km" is Math.round().
        return formatted + 'km';
    }
}

// Placeholder functions
function initMap(gpxData) { // Renamed parameter to match usage
    console.log("Initializing map with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points to display on map.");
        return;
    }

    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error("Map element not found!");
        return;
    }

    // Initialize map centered on the first point
    map = L.map('map').setView([gpxData.points[0].lat, gpxData.points[0].lon], 13);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Create and add polyline for the track
    const latLngs = gpxData.points.map(p => [p.lat, p.lon]);
    L.polyline(latLngs, { color: 'blue' }).addTo(map);

    // Fit map bounds to the track
    map.fitBounds(latLngs);

    // Initialize highlight marker (initially at the first point)
    // Ensure trackHighlightMarker is declared globally
    if (trackHighlightMarker) { // Remove previous marker if any
        trackHighlightMarker.remove();
    }
    trackHighlightMarker = L.marker([gpxData.points[0].lat, gpxData.points[0].lon], { draggable: false }).addTo(map);
    // To make it less obtrusive initially, you might set its opacity to 0 or use a L.circleMarker
    // For now, a standard marker is fine. We can refine its appearance later.

    // Map mousemove listener to find closest point and update highlight
    map.on('mousemove', function(e) {
        if (!gpxData || !gpxData.points || gpxData.points.length === 0) return;

        let closestPointIndex = -1;
        let minDistance = Infinity;

        gpxData.points.forEach((point, index) => {
            const pointLatLng = L.latLng(point.lat, point.lon); // Create LatLng object for distance calculation
            const distance = e.latlng.distanceTo(pointLatLng); // Use Leaflet's distanceTo
            if (distance < minDistance) {
                minDistance = distance;
                closestPointIndex = index;
            }
        });

        if (closestPointIndex !== -1) {
            // console.log('Closest point index on map hover:', closestPointIndex); // For debugging
            updateHighlight(closestPointIndex);
        }
    });
}

function createAltitudeChart(gpxData) { // Renamed parameter
    console.log("Creating altitude chart with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points for altitude chart.");
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
                borderColor: 'rgb(75, 192, 192)',
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
            interaction: { // Keep interaction for hover tooltips
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => { // Keep for single point highlight on hover
                if (!isDragging && chartElements.length > 0) { // Only when not dragging
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
                autocolors: false, // Recommended by annotation plugin
                annotation: {
                    drawTime: 'afterDatasetsDraw', // Draw annotations on top
                    annotations: {
                        // Annotations will be added dynamically
                    }
                }
                // Remove zoom plugin configuration
            }
        }
    });

    // Attach new mouse event listeners
    altitudeChart.canvas.onmousedown = (e) => handleChartMouseDown({ originalEvent: e, chart: altitudeChart });
    altitudeChart.canvas.onmousemove = (e) => handleChartMouseMove({ originalEvent: e, chart: altitudeChart });
    altitudeChart.canvas.onmouseout = (e) => handleChartMouseLeave({ originalEvent: e, chart: altitudeChart });
    // Note: onmouseup is handled globally by document.onmouseup
}

function createSpeedChart(gpxData) { // Renamed parameter
    console.log("Creating speed chart with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points for speed chart.");
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
                label: 'Smoothed Speed (km/h, 20s avg)', // Updated label
                data: speedData,
                borderColor: 'rgb(255, 99, 132)',
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
            interaction: { // Keep interaction for hover tooltips
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => { // Keep for single point highlight on hover
                 if (!isDragging && chartElements.length > 0) { // Only when not dragging
                    const dataIndex = chartElements[0].index;
                    updateHighlight(dataIndex);
                }
            },
            plugins: {
                autocolors: false, // Recommended by annotation plugin
                annotation: {
                    drawTime: 'afterDatasetsDraw', // Draw annotations on top
                    annotations: {
                        // Annotations will be added dynamically
                    }
                }
                // Remove zoom plugin configuration
            }
        }
    });

    // Attach new mouse event listeners
    speedChart.canvas.onmousedown = (e) => handleChartMouseDown({ originalEvent: e, chart: speedChart });
    speedChart.canvas.onmousemove = (e) => handleChartMouseMove({ originalEvent: e, chart: speedChart });
    speedChart.canvas.onmouseout = (e) => handleChartMouseLeave({ originalEvent: e, chart: speedChart });
    // Note: onmouseup is handled globally by document.onmouseup
}

function updateHighlight(index) {
    clearTimeout(highlightDebounceTimeout);

    // Handle invalid index (null, undefined, -1, etc.) for deselection
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
            // console.log("Highlight cleared or index invalid:", index);
        }, 10); // Small delay to ensure it runs after other updates
        return;
    }

    // Proceed with highlighting for a valid index
    highlightDebounceTimeout = setTimeout(() => {
        if (!gpxData || !gpxData.points || !gpxData.points[index]) {
             // console.warn("Invalid data for highlight after delay:", index);
            return;
        }
        const point = gpxData.points[index];

        // Map Highlight
        if (map && trackHighlightMarker) {
            trackHighlightMarker.setLatLng([point.lat, point.lon]);
            if (!map.hasLayer(trackHighlightMarker)) {
                trackHighlightMarker.addTo(map);
            }
        } else if (map && !trackHighlightMarker && gpxData.points[0]) { // Re-initialize if cleared and now valid
            trackHighlightMarker = L.marker([gpxData.points[0].lat, gpxData.points[0].lon], { draggable: false });
            // Note: This might place it at point 0 if called with a valid index but marker was removed.
            // Consider if this re-initialization is always desired or if it should only be at point 'index'.
            // For now, if it was removed, adding it back at the current point.
            trackHighlightMarker.setLatLng([point.lat, point.lon]).addTo(map);
        }


        // Altitude Chart Highlight
        if (altitudeChart) { // Check if chart exists
            // Ensure point data is available for the chart as well
            if (altitudeChart.data && altitudeChart.data.datasets[0] && altitudeChart.data.datasets[0].data[index] !== undefined) {
                 if (!altitudeChart.getActiveElements() || altitudeChart.getActiveElements().length === 0 || altitudeChart.getActiveElements()[0].index !== index) {
                    altitudeChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    altitudeChart.update('none');
                }
            }
        }

        // Speed Chart Highlight
        if (speedChart) { // Check if chart exists
            if (speedChart.data && speedChart.data.datasets[0] && speedChart.data.datasets[0].data[index] !== undefined) {
                if (!speedChart.getActiveElements() || speedChart.getActiveElements().length === 0 || speedChart.getActiveElements()[0].index !== index) {
                    speedChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    speedChart.update('none');
                }
            }
        }
        // console.log("Highlighting point index:", index, "Lat:", point.lat, "Lon:", point.lon);
    }, 10); // Debounce time in ms
}


function highlightRangeOnMap(startIndex, endIndex) {
    if (!map) return; // Make sure map is initialized

    // Clear previous range highlight if it exists
    if (rangePolyline) {
        rangePolyline.remove();
        rangePolyline = null;
    }

    // Check if the indices are valid and gpxData.points exists
    if (gpxData && gpxData.points && gpxData.points.length > 0 && startIndex !== null && endIndex !== null && startIndex <= endIndex && startIndex >= 0 && endIndex < gpxData.points.length) {
        const selectedPoints = gpxData.points.slice(startIndex, endIndex + 1);
        const latLngs = selectedPoints.map(p => [p.lat, p.lon]);

        if (latLngs.length > 1) { // Need at least two points to draw a line
            rangePolyline = L.polyline(latLngs, {
                color: 'red', // Or any other distinct color
                weight: 5,     // Make it thicker than the main track
                opacity: 0.7
            }).addTo(map);

            // Optional: Fit map to the selected range bounds
            // map.fitBounds(rangePolyline.getBounds());
            // Decided against auto-fitting bounds for now to avoid jarring map movements.
            // User can manually zoom if needed.
        }
    } else {
        // If indices are invalid or null, it effectively means deselection for the map highlight
        console.log("Invalid range or no range selected, clearing map highlight.");
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
        console.log(`Calculating stats for range: ${startIndex} - ${endIndex}, ${pointsToProcess.length} points`);
    } else {
        console.log("Calculating stats for full track.");
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
    if (totalTimeInSeconds > 0 && rangeTotalDistanceMeters > 0) { // ensure distance is also > 0 for meaningful avg speed
        calculatedAverageSpeedKmh = (rangeTotalDistanceMeters / totalTimeInSeconds) * 3.6;
    } else if (rangeTotalDistanceMeters === 0 && totalTimeInSeconds === 0 && pointsToProcess.length ===1){
        calculatedAverageSpeedKmh = 0; // Single point, avg speed is 0
    }


    let calculatedTotalAscent = 0;
    if (pointsToProcess.length > 0) { // Check if there are points to process
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
    if (pointsToProcess.length > 0) { // Check if there are points to process
        pointsToProcess.forEach(point => {
            if (point.speed !== null && !isNaN(point.speed) && point.speed > calculatedMaxSpeedKmh) {
                calculatedMaxSpeedKmh = point.speed;
            }
        });
         if (pointsToProcess.length === 1 && pointsToProcess[0].speed !== null && !isNaN(pointsToProcess[0].speed)){
            calculatedMaxSpeedKmh = pointsToProcess[0].speed; // For single point, max speed is its own speed
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
    statsHTML += '</div>';

    statsContainer.innerHTML = statsHTML;
}
