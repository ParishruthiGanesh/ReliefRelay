'use client';

import 'leaflet/dist/leaflet.css';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { MapPoint } from './MapView';

/**
 * The Leaflet layer, loaded only in the browser.
 *
 * Circle markers avoid shipping pin images, and the advisory circles show a
 * source's stated coverage rather than a precise boundary we do not have.
 */
export function LeafletMap({
  points,
  center,
  zoom,
  toneColors,
}: {
  points: MapPoint[];
  center: { lat: number; lng: number };
  zoom: number;
  toneColors: Record<MapPoint['tone'], string>;
}) {
  return (
    <MapContainer center={[center.lat, center.lng]} scrollWheelZoom={false} zoom={zoom}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points
        .filter((point) => point.radiusKm)
        .map((point) => (
          <Circle
            center={[point.lat, point.lng]}
            key={`area-${point.id}`}
            pathOptions={{
              color: toneColors[point.tone],
              fillColor: toneColors[point.tone],
              fillOpacity: 0.08,
              dashArray: '6 6',
            }}
            radius={(point.radiusKm ?? 0) * 1000}
          >
            <Popup>
              <strong>{point.label}</strong>
              <br />
              {point.detail}
            </Popup>
          </Circle>
        ))}
      {points.map((point) => (
        <CircleMarker
          center={[point.lat, point.lng]}
          key={point.id}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: toneColors[point.tone],
            fillOpacity: 0.95,
          }}
          radius={9}
        >
          <Popup>
            <strong>{point.label}</strong>
            {point.detail ? (
              <>
                <br />
                {point.detail}
              </>
            ) : null}
            {point.href ? (
              <>
                <br />
                <a href={point.href}>Open</a>
              </>
            ) : null}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
