// collapsible panels
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".collapsible").forEach(btn => {
        btn.addEventListener("click", () => {
            let c = btn.nextElementSibling;
            c.style.maxHeight = c.style.maxHeight ? null : c.scrollHeight + "px";
        });
    });
});

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI/180;
    let dLat = toRad(lat2-lat1);
    let dLon = toRad(lon2-lon1);
    let a = Math.sin(dLat/2)**2 +
        Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
        Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function optimizePower(grad, ftp, IF){
    let base = ftp*IF;
    let adj = grad>0.06?0.15:grad>0.03?0.1:grad>-0.02?0:grad>-0.05?-0.15:-0.25;
    let p = base*(1+adj);
    return Math.max(ftp*0.5, Math.min(ftp*1.05, p));
}

function getTerrainType(gradPct){
    if(gradPct < -2)  return "descent";
    if(gradPct < 2)   return "flat";
    if(gradPct < 5)   return "easy climb";
    if(gradPct < 10)  return "super climb";
    return "hard climb";
}

function terrainColor(type){
    return {
        "descent":    "#3b82f6",
        "flat":       "#22c55e",
        "easy climb": "#f59e0b",
        "super climb":"#f97316",
        "hard climb": "#ef4444"
    }[type] || "gray";
}

function terrainEmoji(type){
    return {
        "descent":    "⬇️",
        "flat":       "➡️",
        "easy climb": "⬆️",
        "super climb":"🔺",
        "hard climb": "🚵"
    }[type] || "";
}

let chart;
function runCalc(){
    let ftp = +document.getElementById("ftp").value;
    let IF  = +document.getElementById("targetIF").value;
    let crr = +document.getElementById("crr").value;
    let file = document.getElementById("gpxFile").files[0];
    if(!ftp || !file){
        alert("Enter FTP + GPX");
        return;
    }
    let reader = new FileReader();
    reader.onload = function(e){
        let xml = new DOMParser().parseFromString(e.target.result,"text/xml");
        let pts = xml.getElementsByTagName("trkpt");
        let dist=[0], elev=[0], td=0;

        let firstEle = pts[0] ? pts[0].getElementsByTagName("ele")[0] : null;
        elev[0] = firstEle ? +firstEle.textContent : 0;

        for(let i=1;i<pts.length;i++){
            let p1=pts[i-1], p2=pts[i];
            let d = haversine(
                +p1.getAttribute("lat"),
                +p1.getAttribute("lon"),
                +p2.getAttribute("lat"),
                +p2.getAttribute("lon")
            );
            td+=d;
            dist.push(td/1000);
            let eleTag = p2.getElementsByTagName("ele")[0];
            elev.push(eleTag ? +eleTag.textContent : elev[elev.length-1]);
        }

        // build per-point colors and terrain-based segments
        let colors = [];
        let segments = [];
        let segType = null;
        let segStart = dist[1];
        let segPowerSum = 0, segGradSum = 0, segCount = 0;

        for(let i=1;i<elev.length;i++){
            let d=(dist[i]-dist[i-1])*1000;
            if(d===0){ colors.push("gray"); continue; }
            let grad=(elev[i]-elev[i-1])/d;
            let gradPct = grad*100;
            let power = optimizePower(grad, ftp, IF);
            let type = getTerrainType(gradPct);
            colors.push(terrainColor(type));

            if(segType === null) segType = type;

            if(type !== segType){
                segments.push({
                    startKm:  segStart,
                    endKm:    dist[i],
                    type:     segType,
                    avgGrad:  segGradSum / segCount,
                    avgPower: segPowerSum / segCount
                });
                segStart    = dist[i];
                segType     = type;
                segPowerSum = 0;
                segGradSum  = 0;
                segCount    = 0;
            }
            segPowerSum += power;
            segGradSum  += gradPct;
            segCount++;
        }
        if(segCount > 0){
            segments.push({
                startKm:  segStart,
                endKm:    dist[dist.length-1],
                type:     segType,
                avgGrad:  segGradSum / segCount,
                avgPower: segPowerSum / segCount
            });
        }

        // render segments
        let html = segments.map(seg => {
            let c = terrainColor(seg.type);
            let emoji = terrainEmoji(seg.type);
            return `<div class="segment" style="border-left:4px solid ${c};padding-left:10px;margin:4px 0">
                <strong style="color:${c}">${emoji} ${seg.type.toUpperCase()}</strong>
                &nbsp;|&nbsp;
                ${seg.startKm.toFixed(1)} – ${seg.endKm.toFixed(1)} km
                &nbsp;|&nbsp;
                avg grade: ${seg.avgGrad.toFixed(1)}%
                &nbsp;|&nbsp;
                avg power: ${Math.round(seg.avgPower)}W
            </div>`;
        }).join("");

        document.getElementById("segments").innerHTML = html;

        if(chart) chart.destroy();
        chart = new Chart(document.getElementById("chart"),{
            type:"line",
            data:{
                labels: dist,
                datasets:[{
                    label:"Elevation (m)",
                    data: elev,
                    borderColor:"#0077cc",
                    backgroundColor:"rgba(0,119,204,0.1)",
                    pointBackgroundColor: colors,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.3
                }]
            },
            options:{
                responsive:true,
                plugins:{
                    legend:{ display:false }
                },
                scales:{
                    x:{
                        ticks:{
                            maxTicksLimit:10,
                            callback: function(val, index){
                                return parseFloat(dist[index]).toFixed(1) + " km";
                            }
                        },
                        title:{ display:true, text:"Distance (km)" }
                    },
                    y:{
                        title:{ display:true, text:"Elevation (m)" }
                    }
                }
            }
        });
    };
    reader.readAsText(file);
}
