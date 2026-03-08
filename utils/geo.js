/**
 * 逆地理编码：经纬度 -> 城市名（用于智能体发单时填充 demand.city）
 * 使用高德 Web 服务 API，需配置 AMAP_KEY
 */
const https = require('https');

function reverseGeocode(latitude, longitude) {
    const key = (process.env.AMAP_KEY || process.env.AMAP_WEB_SERVICE_KEY || '').trim();
    if (!key) return Promise.resolve(null);
    const location = `${Number(longitude)},${Number(latitude)}`; // 高德要求 经度,纬度
    return new Promise((resolve) => {
        const url = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${encodeURIComponent(location)}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', (ch) => { data += ch; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const addr = json.regeocodes && json.regeocodes[0];
                    const comp = addr && addr.addressComponent;
                    const city = (comp && (comp.city || comp.province)) || null;
                    resolve(city || null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

module.exports = { reverseGeocode };
