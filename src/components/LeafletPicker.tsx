'use client';

import 'leaflet/dist/leaflet.css';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * The map a member of the public uses to place their own location.
 *
 * Tapping the map sets the point. The pin is deliberately the only thing that
 * creates coordinates here — nothing is inferred from what someone typed.
 */

export interface PickerFacility {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/** Recentres when the point changes from outside, e.g. after "use my location". */
function Recentre({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat !== null && lng !== null) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng, map]);
  return null;
}

export function LeafletPicker({
  center,
  chosen,
  facilities,
  accuracyMetres,
  onPick,
}: {
  center: { lat: number; lng: number };
  chosen: { lat: number; lng: number } | null;
  facilities: PickerFacility[];
  accuracyMetres: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={[chosen?.lat ?? center.lat, chosen?.lng ?? center.lng]}
      scrollWheelZoom={false}
      zoom={13}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />
      <Recentre lat={chosen?.lat ?? null} lng={chosen?.lng ?? null} />

      {facilities.map((facility) => (
        <CircleMarker
          center={[facility.lat, facility.lng]}
          eventHandlers={{ click: () => onPick(facility.lat, facility.lng) }}
          key={facility.id}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: facility.kind === 'shelter' ? '#0f6b66' : '#17807a',
            fillOpacity: 0.9,
          }}
          radius={8}
        >
          <Tooltip>{facility.name}</Tooltip>
        </CircleMarker>
      ))}

      {/* How precise the device said it was — shown rather than implied. */}
      {chosen && accuracyMetres ? (
        <Circle
          center={[chosen.lat, chosen.lng]}
          pathOptions={{ color: '#c2560f', fillColor: '#c2560f', fillOpacity: 0.08, dashArray: '5 5' }}
          radius={accuracyMetres}
        />
      ) : null}

      {chosen ? (
        <CircleMarker
          center={[chosen.lat, chosen.lng]}
          pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#c2560f', fillOpacity: 1 }}
          radius={11}
        >
          <Tooltip permanent>You are here</Tooltip>
        </CircleMarker>
      ) : null}
    </MapContainer>
  );
}
