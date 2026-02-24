export interface LearnedPattern {
  id: string;
  name: string;
  occurrences: number;
  contexts: string[];
  success_rate: number;
  key_decisions: string[];
  first_seen: string;
  last_seen: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface MemoryCalibration {
  category: string;
  total_injections: number;
  led_to_success: number;
  effectiveness: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface LearningState {
  patterns: LearnedPattern[];
  calibration: MemoryCalibration[];
  last_updated: string;
}

export interface SkillTemplate {
  name: string;
  pattern_id: string;
  generated_at: string;
  success_rate: number;
  content: string;
}
