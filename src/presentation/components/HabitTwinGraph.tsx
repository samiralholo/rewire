/**
 * Presentation — Habit Twin Graph (the neuroplasticity picture)
 * ---------------------------------------------------------------------------
 * A radial projection of the twin's `cues` edges: the behavior sits at the
 * center; each trigger orbits it. Learned strength maps to THREE physical
 * channels at once, so the difference is unmissable:
 *
 *   weight -> edge thickness   (1.5px .. 7px)
 *   weight -> edge opacity     (0.25 .. 0.95)
 *   weight -> node proximity   (strong cues sit CLOSER to the center)
 *
 * As interception weakens an edge, its line visibly thins, fades, and
 * drifts outward — rewiring, made literal. Zero-guilt palette: association
 * strength is slate-to-blue; nothing is ever red.
 *
 * Domain-agnostic: node labels are vocabulary keys resolved through the
 * i18n 'domain' namespace (fed by the active DomainPack). This component
 * contains no domain words and renders any pack's graph unchanged.
 */

import { Fragment, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { useDomainLabel, useHabitGraph } from '../hooks/twinData';
import { palette } from '../theme';

// ---------------------------------------------------------------------------
// Weight -> visual channel mappings
// ---------------------------------------------------------------------------

const STROKE_MIN = 1.5;
const STROKE_MAX = 7;
const OPACITY_MIN = 0.25;
const OPACITY_MAX = 0.95;
/** Orbit radii as fractions of the drawable radius: strong = close. */
const ORBIT_NEAR = 0.42;
const ORBIT_FAR = 0.88;
const CENTER_R = 26;
const NODE_R_MIN = 9;
const NODE_R_MAX = 15;
const LABEL_OFFSET = 14;
const MAX_NODES = 12; // legibility cap; strongest first (hook pre-sorts)

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Linear blend between two hex colors (slate border -> action blue). */
const lerpColor = (from: string, to: string, t: number): string => {
  const f = parseInt(from.slice(1), 16);
  const g = parseInt(to.slice(1), 16);
  const ch = (shift: number): number =>
    Math.round(lerp((f >> shift) & 0xff, (g >> shift) & 0xff, t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HabitTwinGraph(): React.JSX.Element | null {
  const { t } = useTranslation();
  const label = useDomainLabel();
  const { behaviorLabelKey, nodes } = useHabitGraph();
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent): void =>
    setWidth(Math.round(e.nativeEvent.layout.width));

  if (nodes.length === 0) return null; // parent renders the empty-state copy

  const shown = nodes.slice(0, MAX_NODES);
  const size = width || 320;
  const cx = size / 2;
  const cy = size / 2;
  const drawableR = size / 2 - 44; // headroom for labels at the far orbit

  const positioned = shown.map((node, index) => {
    const angle = (index / shown.length) * 2 * Math.PI - Math.PI / 2;
    const w = Math.max(0, Math.min(1, node.edgeWeight));
    // Strong association -> smaller orbit (physically closer to the habit).
    const orbit = drawableR * lerp(ORBIT_FAR, ORBIT_NEAR, w);
    return {
      ...node,
      w,
      x: cx + orbit * Math.cos(angle),
      y: cy + orbit * Math.sin(angle),
      labelYSign: Math.sin(angle) >= 0 ? 1 : -1,
    };
  });

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 && (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Edges under nodes: thickness + opacity carry the weight. */}
          {positioned.map((n) => (
            <Line
              key={`edge-${n.id}`}
              x1={cx}
              y1={cy}
              x2={n.x}
              y2={n.y}
              stroke={lerpColor(palette.border, palette.action, n.w)}
              strokeWidth={lerp(STROKE_MIN, STROKE_MAX, n.w)}
              strokeOpacity={lerp(OPACITY_MIN, OPACITY_MAX, n.w)}
              strokeLinecap="round"
            />
          ))}

          {/* Trigger nodes + labels. */}
          {positioned.map((n) => (
            <Fragment key={n.id}>
              <Circle
                cx={n.x}
                cy={n.y}
                r={lerp(NODE_R_MIN, NODE_R_MAX, n.w)}
                fill={lerpColor(palette.surface, palette.nudge, n.w)}
                stroke={lerpColor(palette.border, palette.action, n.w)}
                strokeWidth={1.5}
              />
              <SvgText
                x={n.x}
                y={n.y + n.labelYSign * (lerp(NODE_R_MIN, NODE_R_MAX, n.w) + LABEL_OFFSET)}
                fontSize={11}
                fill={palette.inkSoft}
                textAnchor="middle"
              >
                {label(n.labelKey)}
              </SvgText>
            </Fragment>
          ))}

          {/* The behavior, at the center of its own weather system. */}
          <Circle
            cx={cx}
            cy={cy}
            r={CENTER_R}
            fill={palette.action}
            fillOpacity={0.15}
            stroke={palette.action}
            strokeWidth={2}
          />
          <SvgText
            x={cx}
            y={cy + 4}
            fontSize={12}
            fontWeight="600"
            fill={palette.ink}
            textAnchor="middle"
          >
            {behaviorLabelKey ? label(behaviorLabelKey) : t('insights.center_hint')}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
