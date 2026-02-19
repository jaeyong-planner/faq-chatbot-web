
import React from 'react';

interface CardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  footer?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, value, icon, footer }) => {
  return (
    <div className="bg-gray-800 rounded-lg p-6 shadow-lg flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <p className="text-gray-500 font-semibold">{title}</p>
          <div className="text-indigo-500">{icon}</div>
        </div>
        <h3 className="text-3xl font-bold mt-2">{value}</h3>
      </div>
      {footer && <div className="mt-4 text-sm text-gray-500">{footer}</div>}
    </div>
  );
};

export default Card;
