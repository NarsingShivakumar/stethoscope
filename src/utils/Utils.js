import React from 'react'; 

const getTotalDateFormatted = (date) => {   
  let dateStr = null;  

  if (date !== 0) {     
      const options = { day: 'numeric', month: 'short', year: 'numeric' };     
      dateStr = new Date(date).toLocaleDateString('en-US', options);   
  } else {     
      dateStr = '-';   
  }   

  return dateStr; 
};


   
    const getAmount = (amount) => {
        // Check if amount is a valid number
        console.log('Amount:', amount);

        if (typeof amount !== 'number' || isNaN(amount)) {
          return 'Invalid Amount';
        }
      
        // Format the number
        const indianFormat = new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          maximumFractionDigits: 0,
        });
      
        return indianFormat.format(amount);
      };
// Utility function to format date
const formatTotalTimeDate = (dateString) => {
  const date = new Date(dateString);

  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12; 

  return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
};


const formatDate = (dateString) => {
  const date = new Date(dateString);
  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
};
const calculateAge = (birthDate) => {
  const currentDate = new Date();
  const dob = new Date(birthDate);
  
  let age = currentDate.getFullYear() - dob.getFullYear();
  const monthDiff = currentDate.getMonth() - dob.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && currentDate.getDate() < dob.getDate())) {
    age--;
  }
  
  return `${age} years`;
}

export { getTotalDateFormatted, 
  getAmount ,
  formatTotalTimeDate,
  formatDate, 
  calculateAge};