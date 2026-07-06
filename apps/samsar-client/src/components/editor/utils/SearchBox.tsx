import { useState } from 'react';

import { FaSearch } from "react-icons/fa";

const SearchBox = (props) => {
  const { submitSearch } = props;

  const [searchQuery, setSearchQuery, ] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    submitSearch(searchQuery);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search..."
        className="flex-grow p-2 outline-none"
      />
      <button type="submit" className="p-2 bg-blue-500 text-white">
        <FaSearch />
      </button>
    </form>
  );
};

export default SearchBox;
