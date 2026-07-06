import { useEffect, useState } from "react";
import OverflowContainer from "../common/OverflowContainer.tsx";
import { getHeaders } from "../../utils/web";
import { useParams } from "react-router-dom";
import axios from "axios";
import CommonButton from "../common/CommonButton.tsx";
const API_SERVER = import.meta.env.VITE_PROCESSOR_API;


export default function PublicationHome() {

  const { id } = useParams();
  const [, setPublicationData] = useState({});

  useEffect(() => {
    const headers = getHeaders();
    axios.get(`${API_SERVER}/publications/user_publication?tokenId=${id}`, headers).then((res) => {
      const data = res.data;
      setPublicationData(data);
    });

  }, []);

  const handleSubmitBurn = (e) => {
    e.preventDefault();
    const headers = getHeaders();
    const formValues = new FormData(e.target);
    const payload = {
      tokenId: id,
      burnAmount: formValues.get("burnAmount"),
    }
    axios.post(`${API_SERVER}/publications/burn_creator`, payload, headers).then(() => {


    });
  }

  return (
    <OverflowContainer>
      <div className="mt-[60px]">
        <h1>Publication Home</h1>
        <form onSubmit={handleSubmitBurn}>
          <input type="text" name="burnAmount" className="bg-slate-200 w-64 block" />
          <div>
            <CommonButton type="submit">
              Burn
            </CommonButton>
          </div>
        </form>
      </div>
    </OverflowContainer>
  )
}
