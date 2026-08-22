import React from 'react';
import { createRoot } from 'react-dom/client';
import AnnotationUI from './components/AnnotationUI.jsx';
import './annotate.css';

createRoot(document.getElementById('root')).render(<AnnotationUI />);
