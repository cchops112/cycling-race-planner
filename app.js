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
let chart;
function runCalc(){
    let ftp = +document.getElementById("ftp").value;
    let IF = +document.getElementById("targetIF").value;
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
        let dist=[0], elev=[], td=0;
        for(let i=1;i<pts.length;i++){
            let p1=pts[i-1], p2=pts[i];
            let d = haversine(
                p1.getAttribute("lat"),
                p1.getAttribute("lon"),
                p2.getAttribute("lat"),
                p2.getAttribute("lon")
            );
            td+=d;
            dist.push(td/1000);
            elev.push(+p2.getElementsByTagName("ele")[0].textContent);
        }
        let colors=[], html="";
        for(let i=1;i<elev.length;i++){
            let d=(dist[i]-dist[i-1])*1000;
            let grad=(elev[i]-elev[i-1])/d;
            let power = optimizePower(grad, ftp, IF);
            let pct = power/ftp;
            let color = pct>1?"red":pct>0.9?"orange":pct>0.75?"green":"blue";
            colors.push(color);
            if(i%50===0){
                html+=`<div class="segment">
                ${dist[i].toFixed(1)} km —
                ${(grad*100).toFixed(1)}% —
                ${Math.round(power)}W
                </div>`;
            }
        }
        document.getElementById("segments").innerHTML = html;
        if(chart) chart.destroy();
        chart = new Chart(document.getElementById("chart"),{
            type:"line",
            data:{
                labels:dist,
                datasets:[{
                    data:elev,
                    borderColor:"black",
                    pointBackgroundColor:colors,
                    pointRadius:0
                }]
            }
        });
    };
    reader.readAsText(file);
}
