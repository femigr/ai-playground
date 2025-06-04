// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

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
                const gpx = new gpxParser(); // Corrected casing
                gpx.parse(fileContent); // Pass the file content to the parse method

                let infoHtml = `
                    <p><strong>File:</strong> ${file.name}</p>
                    <p><strong>Size:</strong> ${file.size} bytes</p>
                `;

                if (gpx.tracks.length > 0) {
                    const track = gpx.tracks[0]; // Assuming we work with the first track
                    infoHtml += `<p><strong>Track Name:</strong> ${track.name || 'N/A'}</p>`;
                    infoHtml += `<p><strong>Number of Track Points:</strong> ${track.points.length}</p>`;

                    if (track.points.length > 0) {
                        infoHtml += '<strong>First 5 Track Points:</strong><ul>';
                        for (let i = 0; i < Math.min(5, track.points.length); i++) {
                            const point = track.points[i];
                            infoHtml += `<li>Lat: ${point.lat.toFixed(5)}, Lon: ${point.lon.toFixed(5)}`;
                            if (point.ele !== undefined) {
                                infoHtml += `, Ele: ${point.ele.toFixed(2)}m`;
                            }
                            infoHtml += `</li>`;
                        }
                        infoHtml += '</ul>';
                    }
                } else {
                    infoHtml += '<p>No tracks found in this GPX file.</p>';
                }
                gpxDataDisplay.innerHTML = infoHtml;

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
